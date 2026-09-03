use std::sync::{
    Arc,
    Mutex,
};

use agent_core::event::{
    HookHandler,
    LlmCallOutcome,
    TraceContext,
    TurnEvent,
};
use agent_core::llm::protocol::{
    ContentBlock,
    ModelResponseSnapshot,
};
use agent_core::tools::{
    ToolCall,
    ToolResult,
};
use anyhow::{
    anyhow,
    Context,
    Result,
};
use tokio::sync::{
    mpsc,
    oneshot,
};

use crate::config::ProgressObserver;

const PROGRESS_QUEUE_CAPACITY: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgressWorkerState {
    Running,
    Degraded,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgressStatus {
    pub state: ProgressWorkerState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub resync_required: bool,
    pub last_error: Option<String>,
}

#[derive(Debug)]
struct ProgressStatusState {
    state: ProgressWorkerState,
    dropped_events: u64,
    resync_required: bool,
    last_error: Option<String>,
}

impl Default for ProgressStatusState {
    fn default() -> Self {
        Self {
            state: ProgressWorkerState::Running,
            dropped_events: 0,
            resync_required: false,
            last_error: None,
        }
    }
}

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

/// Handle for draining the asynchronous progress observer queue.
pub struct ProgressHandle {
    sender: mpsc::Sender<ProgressCommand>,
    status: Arc<Mutex<ProgressStatusState>>,
}

impl ProgressHandle {
    /// Waits until all progress commands currently queued have been consumed.
    pub async fn flush(&self) -> Result<()> {
        let (ack, completion) = oneshot::channel();
        if let Err(error) = self.sender.send(ProgressCommand::Flush { ack }).await {
            mark_stopped(
                &self.status,
                format!("send progress flush command: {error}"),
            );
            return Err(anyhow::anyhow!("send progress flush command: {error}"));
        }
        if let Err(error) = completion.await {
            mark_stopped(
                &self.status,
                format!("await progress worker flush: {error}"),
            );
            return Err(anyhow::anyhow!("await progress worker flush: {error}"));
        }
        Ok(())
    }

    /// Returns a point-in-time worker and queue status without clearing resync state.
    pub fn status(&self) -> ProgressStatus {
        snapshot_status(&self.status, self.sender.capacity())
    }

    /// Returns and clears the resync marker set after queue loss or worker exit.
    pub fn take_resync_required(&self) -> bool {
        match self.status.lock() {
            Ok(mut status) => {
                let required = status.resync_required;
                status.resync_required = false;
                required
            }
            Err(_) => true,
        }
    }
}

pub(crate) struct ProgressHook {
    sender: mpsc::Sender<ProgressCommand>,
    status: Arc<Mutex<ProgressStatusState>>,
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
    pub(crate) fn new(observer: Arc<dyn ProgressObserver>) -> Result<(Self, ProgressHandle)> {
        let status = Arc::new(Mutex::new(ProgressStatusState::default()));
        let handle = tokio::runtime::Handle::try_current()
            .context("ProgressHook requires a Tokio runtime")?;
        let (sender, receiver) = mpsc::channel(PROGRESS_QUEUE_CAPACITY);
        handle.spawn(run_worker(receiver, observer, Arc::clone(&status)));
        Ok((
            Self {
                sender: sender.clone(),
                status: Arc::clone(&status),
                state: Mutex::new(ProgressState::default()),
            },
            ProgressHandle { sender, status },
        ))
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
        let command = match &event {
            ProgressEvent::AssistantResponseSnapshot {
                turn, llm_call_id, ..
            } => ProgressCommand::Snapshot {
                key: (*turn, llm_call_id.clone()),
                event,
            },
            _ => ProgressCommand::Event(event),
        };
        match self.sender.try_send(command) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(_)) => {
                mark_dropped(&self.status);
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                mark_stopped(&self.status, "progress worker channel closed".to_owned());
            }
        }
    }
}

async fn run_worker(
    mut receiver: mpsc::Receiver<ProgressCommand>,
    observer: Arc<dyn ProgressObserver>,
    status: Arc<Mutex<ProgressStatusState>>,
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
            ProgressCommand::Event(event) => notify_observer(observer.as_ref(), &event, &status),
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

                notify_observer(observer.as_ref(), &event, &status);
            }
            ProgressCommand::Flush { ack } => {
                let _ = ack.send(());
            }
        }
    }
    mark_stopped(&status, "progress worker stopped".to_owned());
}

fn notify_observer(
    observer: &dyn ProgressObserver,
    event: &ProgressEvent,
    status: &Arc<Mutex<ProgressStatusState>>,
) {
    if let Err(error) = observer.on_progress(event) {
        mark_degraded(status, format!("progress observer failed: {error:#}"));
    }
}

fn mark_dropped(status: &Arc<Mutex<ProgressStatusState>>) {
    if let Ok(mut status) = status.lock() {
        status.state = ProgressWorkerState::Degraded;
        status.dropped_events = status.dropped_events.saturating_add(1);
        status.resync_required = true;
        status.last_error = Some("progress queue full; event dropped".to_owned());
    }
}

fn mark_degraded(status: &Arc<Mutex<ProgressStatusState>>, error: String) {
    if let Ok(mut status) = status.lock() {
        if status.state != ProgressWorkerState::Stopped {
            status.state = ProgressWorkerState::Degraded;
        }
        status.last_error = Some(error);
    }
}

fn mark_stopped(status: &Arc<Mutex<ProgressStatusState>>, error: String) {
    if let Ok(mut status) = status.lock() {
        status.state = ProgressWorkerState::Stopped;
        status.resync_required = true;
        status.last_error = Some(error);
    }
}

fn snapshot_status(
    status: &Arc<Mutex<ProgressStatusState>>,
    available_capacity: usize,
) -> ProgressStatus {
    let queue_len = PROGRESS_QUEUE_CAPACITY.saturating_sub(available_capacity);
    match status.lock() {
        Ok(status) => ProgressStatus {
            state: status.state,
            queue_capacity: PROGRESS_QUEUE_CAPACITY,
            queue_len,
            dropped_events: status.dropped_events,
            resync_required: status.resync_required,
            last_error: status.last_error.clone(),
        },
        Err(_) => ProgressStatus {
            state: ProgressWorkerState::Stopped,
            queue_capacity: PROGRESS_QUEUE_CAPACITY,
            queue_len,
            dropped_events: 0,
            resync_required: true,
            last_error: Some("progress status lock poisoned".to_owned()),
        },
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
    use agent_core::event::{
        LlmCallFailureKind,
        LlmCallOutcome,
        TurnEvent,
    };
    use agent_core::llm::protocol::{
        ContentBlock,
        ModelResponseSnapshot,
        PendingBlock,
        StopReason,
        Usage,
    };
    use agent_core::tools::{
        ToolCall,
        ToolContent,
        ToolResult,
    };

    use super::*;
    use crate::config::ProgressObserver;

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

    struct FailingObserver;

    impl ProgressObserver for FailingObserver {
        fn on_progress(&self, _event: &ProgressEvent) -> Result<()> {
            Err(anyhow::anyhow!("observer unavailable"))
        }
    }

    // Scenario: the progress observer fails while consuming a queued event.
    // Expected: the worker remains fail-open but reports Degraded and last_error.
    // Invariant: observer failure does not return through the Hook or block flush.
    #[tokio::test]
    async fn worker_status_records_observer_failure() {
        let observer = Arc::new(FailingObserver);
        let (hook, handle) = ProgressHook::new(observer).expect("runtime should be available");
        hook.on_event(
            &TraceContext::new("run-status", "session-status"),
            &TurnEvent::TurnStarted { turn: 1 },
        )
        .expect("hook should enqueue without observer failure");

        handle
            .flush()
            .await
            .expect("worker should flush queued event");

        let status = handle.status();
        assert_eq!(status.state, ProgressWorkerState::Degraded);
        assert_eq!(status.queue_capacity, PROGRESS_QUEUE_CAPACITY);
        assert_eq!(status.queue_len, 0);
        assert_eq!(status.dropped_events, 0);
        assert!(!status.resync_required);
        assert!(status
            .last_error
            .as_deref()
            .is_some_and(|error| error.contains("observer unavailable")));
    }

    // Scenario: two queued snapshots for one call precede a lifecycle event.
    // Expected: the worker delivers only the latest snapshot, then preserves the lifecycle event.
    // Invariant: coalescing never crosses a call identity or reorders lifecycle events.
    #[tokio::test]
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

        let status = Arc::new(Mutex::new(ProgressStatusState::default()));
        let worker_status = Arc::clone(&status);
        let worker = tokio::spawn(run_worker(receiver, observer, worker_status));
        completion.await.expect("worker should flush");
        drop(sender);
        worker.await.expect("worker should stop");

        let status = snapshot_status(&status, PROGRESS_QUEUE_CAPACITY);
        assert_eq!(status.state, ProgressWorkerState::Stopped);
        assert!(status.resync_required);

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
