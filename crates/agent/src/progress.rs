use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use agent_core::{
    event::{HookHandler, LlmCallOutcome, TraceContext, TurnEvent},
    llm::protocol::{ContentBlock, ModelResponseSnapshot},
    tools::{ToolCall, ToolResult},
};
use anyhow::{anyhow, Context, Result};
use tokio::sync::{mpsc, oneshot};

use crate::config::ProgressObserver;

const PROGRESS_QUEUE_CAPACITY: usize = 256;

/// Safe semantic progress events exposed by the composition root.
#[derive(Debug, Clone, PartialEq)]
pub enum ProgressEvent {
    TurnStarted {
        turn: u64,
    },
    LlmCallStarted {
        turn: u64,
        step: u32,
        llm_call_id: String,
    },
    AssistantResponseSnapshot {
        turn: u64,
        step: u32,
        llm_call_id: String,
        update_index: u32,
        snapshot: ModelResponseSnapshot,
    },
    ToolCall {
        turn: u64,
        call: ToolCall,
    },
    ToolResult {
        turn: u64,
        result: ToolResult,
    },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        outcome: LlmCallOutcome,
    },
    AssistantFinalized {
        turn: u64,
        llm_call_id: String,
        blocks: Vec<ContentBlock>,
    },
    TurnEnded {
        turn: u64,
    },
}

enum ProgressCommand {
    Event(ProgressEvent),
    Snapshot {
        key: (u64, String),
        event: ProgressEvent,
    },
    Flush {
        ack: oneshot::Sender<()>,
    },
}

enum ProgressSink {
    Queued {
        sender: mpsc::Sender<ProgressCommand>,
        resync_required: Arc<AtomicBool>,
    },
    Direct {
        observer: Arc<dyn ProgressObserver>,
    },
}

/// Handle for draining the asynchronous progress observer queue.
pub struct ProgressHandle {
    sender: Option<mpsc::Sender<ProgressCommand>>,
    resync_required: Arc<AtomicBool>,
}

impl ProgressHandle {
    /// Waits until all progress commands currently queued have been consumed.
    pub async fn flush(&self) -> Result<()> {
        let Some(sender) = &self.sender else {
            return Ok(());
        };
        let (ack, completion) = oneshot::channel();
        sender
            .send(ProgressCommand::Flush { ack })
            .await
            .context("send progress flush command")?;
        completion.await.context("await progress worker flush")?;
        Ok(())
    }

    /// Returns and clears the resync marker set after queue loss or worker exit.
    pub fn take_resync_required(&self) -> bool {
        self.resync_required.swap(false, Ordering::AcqRel)
    }
}

pub(crate) struct ProgressHook {
    sink: ProgressSink,
    state: Mutex<ProgressState>,
}

#[derive(Default)]
struct ProgressState {
    active_call: Option<ActiveCall>,
}

struct ActiveCall {
    turn: u64,
    step: u32,
    llm_call_id: String,
    next_update_index: u32,
}

impl ProgressHook {
    pub(crate) fn new(observer: Arc<dyn ProgressObserver>) -> (Self, ProgressHandle) {
        let resync_required = Arc::new(AtomicBool::new(false));
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                let (sender, receiver) = mpsc::channel(PROGRESS_QUEUE_CAPACITY);
                handle.spawn(run_worker(receiver, observer));
                (
                    Self {
                        sink: ProgressSink::Queued {
                            sender: sender.clone(),
                            resync_required: Arc::clone(&resync_required),
                        },
                        state: Mutex::new(ProgressState::default()),
                    },
                    ProgressHandle {
                        sender: Some(sender),
                        resync_required,
                    },
                )
            }
            Err(_) => (
                Self {
                    sink: ProgressSink::Direct { observer },
                    state: Mutex::new(ProgressState::default()),
                },
                ProgressHandle {
                    sender: None,
                    resync_required,
                },
            ),
        }
    }
}

impl HookHandler for ProgressHook {
    fn on_event(&self, _ctx: &TraceContext, event: &TurnEvent) -> Result<()> {
        let progress = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| anyhow!("progress state lock poisoned"))?;
            derive_progress(&mut state, event)?
        };
        if let Some(progress) = progress {
            self.enqueue(progress);
        }
        Ok(())
    }
}

impl ProgressHook {
    fn enqueue(&self, event: ProgressEvent) {
        match &self.sink {
            ProgressSink::Queued {
                sender,
                resync_required,
            } => {
                let command = match &event {
                    ProgressEvent::AssistantResponseSnapshot {
                        turn, llm_call_id, ..
                    } => ProgressCommand::Snapshot {
                        key: (*turn, llm_call_id.clone()),
                        event,
                    },
                    _ => ProgressCommand::Event(event),
                };
                match sender.try_send(command) {
                    Ok(()) => {}
                    Err(error) => {
                        resync_required.store(true, Ordering::Release);
                        eprintln!("progress event dropped: {error}");
                    }
                }
            }
            ProgressSink::Direct { observer } => {
                if let Err(error) = observer.on_progress(&event) {
                    eprintln!("progress observer failed: {error:#}");
                }
            }
        }
    }
}

async fn run_worker(
    mut receiver: mpsc::Receiver<ProgressCommand>,
    observer: Arc<dyn ProgressObserver>,
) {
    let mut pending = None;
    loop {
        let command = match pending.take() {
            Some(command) => command,
            None => match receiver.recv().await {
                Some(command) => command,
                None => break,
            },
        };
        match command {
            ProgressCommand::Event(event) => notify_observer(observer.as_ref(), &event),
            ProgressCommand::Snapshot { key, mut event } => {
                loop {
                    match receiver.try_recv() {
                        Ok(ProgressCommand::Snapshot {
                            key: next_key,
                            event: next_event,
                        }) if next_key == key => {
                            event = next_event;
                        }
                        Ok(next) => {
                            pending = Some(next);
                            break;
                        }
                        Err(mpsc::error::TryRecvError::Empty)
                        | Err(mpsc::error::TryRecvError::Disconnected) => break,
                    }
                }

                notify_observer(observer.as_ref(), &event);
            }
            ProgressCommand::Flush { ack } => {
                let _ = ack.send(());
            }
        }
    }
}

fn notify_observer(observer: &dyn ProgressObserver, event: &ProgressEvent) {
    if let Err(error) = observer.on_progress(event) {
        eprintln!("progress observer failed: {error:#}");
    }
}

fn derive_progress(state: &mut ProgressState, event: &TurnEvent) -> Result<Option<ProgressEvent>> {
    let progress = match event {
        TurnEvent::TurnStarted { turn } => Some(ProgressEvent::TurnStarted { turn: *turn }),
        TurnEvent::LlmCallStarted {
            turn,
            step,
            llm_call_id,
        } => {
            state.active_call = Some(ActiveCall {
                turn: *turn,
                step: *step,
                llm_call_id: llm_call_id.clone(),
                next_update_index: 0,
            });
            Some(ProgressEvent::LlmCallStarted {
                turn: *turn,
                step: *step,
                llm_call_id: llm_call_id.clone(),
            })
        }
        TurnEvent::MessageUpdate {
            turn,
            step,
            llm_call_id,
            snapshot,
        } => {
            let active = match state.active_call.as_mut() {
                Some(active)
                    if active.turn == *turn
                        && active.step == *step
                        && active.llm_call_id == *llm_call_id =>
                {
                    active
                }
                _ => return Ok(None),
            };
            let update_index = active.next_update_index;
            active.next_update_index = active
                .next_update_index
                .checked_add(1)
                .context("progress snapshot update index overflow")?;
            Some(ProgressEvent::AssistantResponseSnapshot {
                turn: *turn,
                step: *step,
                llm_call_id: llm_call_id.clone(),
                update_index,
                snapshot: snapshot.clone(),
            })
        }
        TurnEvent::ToolCallRecorded { turn, call } => Some(ProgressEvent::ToolCall {
            turn: *turn,
            call: call.clone(),
        }),
        TurnEvent::ToolResultRecorded { turn, result } => Some(ProgressEvent::ToolResult {
            turn: *turn,
            result: result.clone(),
        }),
        TurnEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            outcome,
        } => {
            if state.active_call.as_ref().is_some_and(|active| {
                active.turn == *turn && active.step == *step && active.llm_call_id == *llm_call_id
            }) {
                state.active_call = None;
            }
            Some(ProgressEvent::LlmCallEnded {
                turn: *turn,
                step: *step,
                llm_call_id: llm_call_id.clone(),
                outcome: outcome.clone(),
            })
        }
        TurnEvent::AssistantFinalized {
            turn,
            llm_call_id,
            blocks,
        } => Some(ProgressEvent::AssistantFinalized {
            turn: *turn,
            llm_call_id: llm_call_id.clone(),
            blocks: blocks.clone(),
        }),
        TurnEvent::TurnEnded { turn } => Some(ProgressEvent::TurnEnded { turn: *turn }),
        _ => None,
    };
    Ok(progress)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProgressObserver;
    use agent_core::{
        event::{LlmCallFailureKind, LlmCallOutcome, TurnEvent},
        llm::protocol::{ContentBlock, ModelResponseSnapshot, PendingBlock, StopReason, Usage},
        tools::{ToolCall, ToolContent, ToolResult},
    };

    fn state() -> ProgressState {
        ProgressState::default()
    }

    #[test]
    // Scenario: one LLM call emits two complete snapshots.
    // Expected: the host receives call identity and update indexes 0 then 1.
    // Invariant: indexes are local to the call and snapshots replace prior state.
    fn derives_call_and_snapshot_progress() {
        let mut state = state();
        let started = derive_progress(
            &mut state,
            &TurnEvent::LlmCallStarted {
                turn: 2,
                step: 0,
                llm_call_id: "call-1".to_owned(),
            },
        )
        .expect("start derivation should succeed")
        .expect("start should produce progress");
        assert_eq!(
            started,
            ProgressEvent::LlmCallStarted {
                turn: 2,
                step: 0,
                llm_call_id: "call-1".to_owned()
            }
        );

        let snapshot = ModelResponseSnapshot {
            content: vec![ContentBlock::Text {
                text: "Hello".to_owned(),
            }],
            pending: Some(PendingBlock::Text {
                text: " world".to_owned(),
            }),
            stop_reason: None,
            usage: None,
            model: Some("test-model".to_owned()),
        };
        let first = derive_progress(
            &mut state,
            &TurnEvent::MessageUpdate {
                turn: 2,
                step: 0,
                llm_call_id: "call-1".to_owned(),
                snapshot: snapshot.clone(),
            },
        )
        .expect("first snapshot derivation should succeed")
        .expect("first snapshot should produce progress");
        let second = derive_progress(
            &mut state,
            &TurnEvent::MessageUpdate {
                turn: 2,
                step: 0,
                llm_call_id: "call-1".to_owned(),
                snapshot,
            },
        )
        .expect("second snapshot derivation should succeed")
        .expect("second snapshot should produce progress");

        assert!(matches!(
            first,
            ProgressEvent::AssistantResponseSnapshot {
                update_index: 0,
                ref llm_call_id,
                ..
            } if llm_call_id == "call-1"
        ));
        assert!(matches!(
            second,
            ProgressEvent::AssistantResponseSnapshot {
                update_index: 1,
                ..
            }
        ));
    }

    #[test]
    // Scenario: a retry starts a new model-call attempt at the same step.
    // Expected: the new call identity resets its snapshot index to zero.
    // Invariant: retry identity is never merged with the previous draft.
    fn retry_resets_snapshot_index_for_new_call() {
        let mut state = state();
        derive_progress(
            &mut state,
            &TurnEvent::LlmCallStarted {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".to_owned(),
            },
        )
        .expect("first call should derive");
        derive_progress(
            &mut state,
            &TurnEvent::MessageUpdate {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".to_owned(),
                snapshot: ModelResponseSnapshot {
                    content: Vec::new(),
                    pending: None,
                    stop_reason: None,
                    usage: None,
                    model: None,
                },
            },
        )
        .expect("first call snapshot should derive");
        derive_progress(
            &mut state,
            &TurnEvent::LlmCallStarted {
                turn: 1,
                step: 0,
                llm_call_id: "call-2".to_owned(),
            },
        )
        .expect("retry call should derive");
        let retry_snapshot = derive_progress(
            &mut state,
            &TurnEvent::MessageUpdate {
                turn: 1,
                step: 0,
                llm_call_id: "call-2".to_owned(),
                snapshot: ModelResponseSnapshot {
                    content: Vec::new(),
                    pending: None,
                    stop_reason: None,
                    usage: None,
                    model: None,
                },
            },
        )
        .expect("retry snapshot should derive")
        .expect("retry snapshot should produce progress");

        assert!(matches!(
            retry_snapshot,
            ProgressEvent::AssistantResponseSnapshot {
                update_index: 0,
                llm_call_id,
                ..
            } if llm_call_id == "call-2"
        ));
    }

    #[test]
    // Scenario: canonical tool call/result events cross the host boundary.
    // Expected: typed payloads and status remain intact for frontend formatting.
    // Invariant: progress does not truncate or reconstruct tool domain fields.
    fn preserves_typed_tool_payloads() {
        let call = ToolCall::new("tool-1", "bash", serde_json::json!({"command": "pwd"}))
            .expect("tool call should be valid");
        let result = ToolResult::succeeded(&call, ToolContent::Text("ok".to_owned()));
        let mut state = state();
        let mapped_call = derive_progress(
            &mut state,
            &TurnEvent::ToolCallRecorded {
                turn: 2,
                call: call.clone(),
            },
        )
        .expect("tool call derivation should succeed")
        .expect("tool call should produce progress");
        let mapped_result = derive_progress(
            &mut state,
            &TurnEvent::ToolResultRecorded { turn: 2, result },
        )
        .expect("tool result derivation should succeed")
        .expect("tool result should produce progress");

        assert!(
            matches!(mapped_call, ProgressEvent::ToolCall { call: mapped, .. } if mapped == call)
        );
        assert!(
            matches!(mapped_result, ProgressEvent::ToolResult { result, .. } if result.tool_use_id() == "tool-1")
        );
    }

    #[test]
    // Scenario: a successful call is finalized after its response is classified.
    // Expected: typed outcome and finalized identity are both visible to the host.
    // Invariant: finalized blocks are the post-commit payload and empty blocks remain a marker.
    fn forwards_typed_outcome_and_finalized_identity() {
        let mut state = state();
        let ended = derive_progress(
            &mut state,
            &TurnEvent::LlmCallEnded {
                turn: 3,
                step: 1,
                llm_call_id: "call-3".to_owned(),
                outcome: LlmCallOutcome::Succeeded {
                    stop_reason: StopReason::EndTurn,
                    usage: Some(Usage {
                        input_tokens: 1,
                        output_tokens: 2,
                    }),
                },
            },
        )
        .expect("ended derivation should succeed")
        .expect("ended event should produce progress");
        let finalized = derive_progress(
            &mut state,
            &TurnEvent::AssistantFinalized {
                turn: 3,
                llm_call_id: "call-3".to_owned(),
                blocks: Vec::new(),
            },
        )
        .expect("finalized derivation should succeed")
        .expect("finalized event should produce progress");

        assert!(matches!(
            ended,
            ProgressEvent::LlmCallEnded {
                outcome: LlmCallOutcome::Succeeded { .. },
                ..
            }
        ));
        assert!(matches!(
            finalized,
            ProgressEvent::AssistantFinalized {
                turn: 3,
                ref llm_call_id,
                ref blocks,
            } if llm_call_id == "call-3" && blocks.is_empty()
        ));

        let failed = LlmCallOutcome::Failed {
            kind: LlmCallFailureKind::InvalidResponse,
        };
        assert!(matches!(
            failed,
            LlmCallOutcome::Failed {
                kind: LlmCallFailureKind::InvalidResponse
            }
        ));
    }

    struct RecordingObserver {
        events: Arc<Mutex<Vec<ProgressEvent>>>,
    }

    impl ProgressObserver for RecordingObserver {
        fn on_progress(&self, event: &ProgressEvent) -> Result<()> {
            self.events
                .lock()
                .expect("observer events lock")
                .push(event.clone());
            Ok(())
        }
    }

    #[tokio::test]
    // Scenario: two queued snapshots for one call precede a lifecycle event.
    // Expected: the worker delivers only the latest snapshot, then preserves the lifecycle event.
    // Invariant: coalescing never crosses a call identity or reorders lifecycle events.
    async fn worker_coalesces_same_call_snapshots() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let observer = Arc::new(RecordingObserver {
            events: Arc::clone(&events),
        });
        let (sender, receiver) = mpsc::channel(8);
        let first = ModelResponseSnapshot {
            content: vec![ContentBlock::Text {
                text: "Hel".to_owned(),
            }],
            pending: None,
            stop_reason: None,
            usage: None,
            model: None,
        };
        let second = ModelResponseSnapshot {
            content: vec![ContentBlock::Text {
                text: "Hello".to_owned(),
            }],
            pending: None,
            stop_reason: None,
            usage: None,
            model: None,
        };
        sender
            .send(ProgressCommand::Snapshot {
                key: (4, "call-4".to_owned()),
                event: ProgressEvent::AssistantResponseSnapshot {
                    turn: 4,
                    step: 0,
                    llm_call_id: "call-4".to_owned(),
                    update_index: 0,
                    snapshot: first,
                },
            })
            .await
            .expect("first snapshot should queue");
        sender
            .send(ProgressCommand::Snapshot {
                key: (4, "call-4".to_owned()),
                event: ProgressEvent::AssistantResponseSnapshot {
                    turn: 4,
                    step: 0,
                    llm_call_id: "call-4".to_owned(),
                    update_index: 1,
                    snapshot: second,
                },
            })
            .await
            .expect("second snapshot should queue");
        sender
            .send(ProgressCommand::Event(ProgressEvent::LlmCallEnded {
                turn: 4,
                step: 0,
                llm_call_id: "call-4".to_owned(),
                outcome: LlmCallOutcome::Succeeded {
                    stop_reason: StopReason::EndTurn,
                    usage: None,
                },
            }))
            .await
            .expect("lifecycle event should queue");
        let (ack, completion) = oneshot::channel();
        sender
            .send(ProgressCommand::Flush { ack })
            .await
            .expect("flush should queue");

        let worker = tokio::spawn(run_worker(receiver, observer));
        completion.await.expect("worker should flush");
        drop(sender);
        worker.await.expect("worker should stop");

        let delivered = events.lock().expect("observer events lock");
        assert_eq!(delivered.len(), 2);
        assert!(matches!(
            &delivered[0],
            ProgressEvent::AssistantResponseSnapshot {
                update_index: 1,
                snapshot: ModelResponseSnapshot { content, .. },
                ..
            } if content == &vec![ContentBlock::Text { text: "Hello".to_owned() }]
        ));
        assert!(matches!(&delivered[1], ProgressEvent::LlmCallEnded { .. }));
    }
}
