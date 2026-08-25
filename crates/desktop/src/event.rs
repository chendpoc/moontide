use std::collections::{BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use agent::ProgressEvent;
use tokio::sync::Notify;

use crate::{
    state::{ActiveAssistantCall, DeliveryStatus, ResyncReason, ShutdownReport},
    ApprovalRequest,
};

#[cfg(test)]
mod tests;

#[derive(Debug, Clone)]
pub struct DesktopEventEnvelope {
    pub seq: u64,
    pub session_id: String,
    pub payload: DesktopEvent,
}

#[derive(Debug, Clone)]
pub enum DesktopEvent {
    StateChanged {
        state: crate::DesktopRunState,
    },
    Progress {
        event: ProgressEvent,
    },
    ApprovalRequested {
        request: ApprovalRequest,
    },
    TurnCompleted {
        turn: u64,
        response: agent::ModelResponse,
    },
    TurnFailed {
        turn: u64,
        error: crate::DesktopError,
    },
    ResyncRequired {
        reason: ResyncReason,
    },
    Stopped {
        report: ShutdownReport,
    },
}

#[derive(Debug)]
struct QueuedEvent {
    envelope: DesktopEventEnvelope,
    snapshot_key: Option<(u64, String)>,
}

#[derive(Debug)]
struct BufferState {
    queue: VecDeque<QueuedEvent>,
    capacity: usize,
    next_seq: u64,
    last_delivered_seq: u64,
    dropped_snapshots: u64,
    resync_required: bool,
    marker_queued: bool,
    session_id: String,
    closed: bool,
    active_assistant_calls: BTreeSet<ActiveAssistantCall>,
}

/// One ordered bounded buffer. Snapshot events are replaceable; control events retain priority.
pub(crate) struct EventBuffer {
    state: Mutex<BufferState>,
    notify: Notify,
}

impl EventBuffer {
    pub(crate) fn new(capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(BufferState {
                queue: VecDeque::with_capacity(capacity),
                capacity,
                next_seq: 1,
                last_delivered_seq: 0,
                dropped_snapshots: 0,
                resync_required: false,
                marker_queued: false,
                session_id: String::new(),
                closed: false,
                active_assistant_calls: BTreeSet::new(),
            }),
            notify: Notify::new(),
        })
    }

    pub(crate) fn publish(&self, session_id: &str, payload: DesktopEvent) -> bool {
        let snapshot_key = snapshot_key(&payload);
        let mut state = lock_state(&self.state);
        if state.closed {
            return false;
        }
        state.session_id = session_id.to_owned();
        update_active_assistant_calls(&mut state, &payload);

        if let Some(key) = snapshot_key.as_ref() {
            if let Some(existing) = state
                .queue
                .iter_mut()
                .find(|queued| queued.snapshot_key.as_ref() == Some(key))
            {
                existing.envelope.payload = payload;
                return true;
            }
        }

        if matches!(payload, DesktopEvent::StateChanged { .. }) {
            if let Some(existing) =
                state.queue.iter_mut().rev().find(|queued| {
                    matches!(queued.envelope.payload, DesktopEvent::StateChanged { .. })
                })
            {
                existing.envelope.payload = payload;
                return true;
            }
        }

        if state.queue.len() >= state.capacity {
            if snapshot_key.is_some() {
                state.dropped_snapshots += 1;
                state.resync_required = true;
                return false;
            }

            if let Some(index) = state
                .queue
                .iter()
                .position(|queued| queued.snapshot_key.is_some())
            {
                state.queue.remove(index);
                state.dropped_snapshots += 1;
                state.resync_required = true;
            } else {
                state.resync_required = true;
                return false;
            }
        }

        let seq = state.next_seq;
        state.next_seq += 1;
        state.queue.push_back(QueuedEvent {
            envelope: DesktopEventEnvelope {
                seq,
                session_id: session_id.to_owned(),
                payload,
            },
            snapshot_key,
        });
        drop(state);
        self.notify.notify_one();
        true
    }

    pub(crate) async fn recv(&self) -> Option<DesktopEventEnvelope> {
        loop {
            let notified = self.notify.notified();
            enum ReceiveAction {
                Event(Box<DesktopEventEnvelope>),
                Closed,
                Wait,
            }
            let action = {
                let mut state = lock_state(&self.state);
                if state.resync_required
                    && !state.marker_queued
                    && state.queue.len() < state.capacity
                {
                    let seq = state.next_seq;
                    state.next_seq += 1;
                    let session_id = state.session_id.clone();
                    state.queue.push_back(QueuedEvent {
                        envelope: DesktopEventEnvelope {
                            seq,
                            session_id,
                            payload: DesktopEvent::ResyncRequired {
                                reason: ResyncReason::WorkerDegraded,
                            },
                        },
                        snapshot_key: None,
                    });
                    state.marker_queued = true;
                }
                if let Some(queued) = state.queue.pop_front() {
                    state.last_delivered_seq = queued.envelope.seq;
                    if matches!(queued.envelope.payload, DesktopEvent::ResyncRequired { .. }) {
                        state.marker_queued = false;
                    }
                    ReceiveAction::Event(Box::new(queued.envelope))
                } else if state.closed {
                    ReceiveAction::Closed
                } else {
                    ReceiveAction::Wait
                }
            };
            match action {
                ReceiveAction::Event(event) => return Some(*event),
                ReceiveAction::Closed => return None,
                ReceiveAction::Wait => notified.await,
            }
        }
    }

    pub(crate) fn status(&self) -> DeliveryStatus {
        let state = lock_state(&self.state);
        DeliveryStatus {
            last_delivered_seq: state.last_delivered_seq,
            resync_required: state.resync_required,
            dropped_snapshots: state.dropped_snapshots,
            buffered_events: state.queue.len(),
        }
    }

    pub(crate) fn acknowledge_resync(&self) {
        let mut state = lock_state(&self.state);
        state.resync_required = false;
    }

    pub(crate) fn active_assistant_calls(&self) -> Vec<ActiveAssistantCall> {
        let state = lock_state(&self.state);
        state.active_assistant_calls.iter().cloned().collect()
    }

    pub(crate) fn close(&self) {
        let mut state = lock_state(&self.state);
        state.closed = true;
        drop(state);
        self.notify.notify_waiters();
    }
}

pub struct DesktopEventStream {
    buffer: Arc<EventBuffer>,
}

impl DesktopEventStream {
    pub(crate) fn new(buffer: Arc<EventBuffer>) -> Self {
        Self { buffer }
    }

    pub async fn recv(&mut self) -> Option<DesktopEventEnvelope> {
        self.buffer.recv().await
    }
}

fn snapshot_key(payload: &DesktopEvent) -> Option<(u64, String)> {
    match payload {
        DesktopEvent::Progress {
            event:
                ProgressEvent::AssistantResponseSnapshot {
                    turn, llm_call_id, ..
                },
        } => Some((*turn, llm_call_id.clone())),
        _ => None,
    }
}

fn update_active_assistant_calls(state: &mut BufferState, payload: &DesktopEvent) {
    let DesktopEvent::Progress { event } = payload else {
        return;
    };

    match event {
        agent::ProgressEvent::AssistantResponseSnapshot {
            turn, llm_call_id, ..
        } => {
            state.active_assistant_calls.insert(ActiveAssistantCall {
                turn: *turn,
                llm_call_id: llm_call_id.clone(),
            });
        }
        agent::ProgressEvent::LlmCallEnded {
            turn,
            llm_call_id,
            outcome: agent::LlmCallOutcome::Failed { .. } | agent::LlmCallOutcome::Cancelled { .. },
            ..
        }
        | agent::ProgressEvent::AssistantFinalized {
            turn, llm_call_id, ..
        } => {
            state.active_assistant_calls.remove(&ActiveAssistantCall {
                turn: *turn,
                llm_call_id: llm_call_id.clone(),
            });
        }
        agent::ProgressEvent::LlmCallStarted { .. }
        | agent::ProgressEvent::LlmCallEnded { .. }
        | agent::ProgressEvent::TurnStarted { .. }
        | agent::ProgressEvent::ToolCall { .. }
        | agent::ProgressEvent::ToolResult { .. }
        | agent::ProgressEvent::TurnEnded { .. } => {}
    }
}

fn lock_state(state: &Mutex<BufferState>) -> std::sync::MutexGuard<'_, BufferState> {
    state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
