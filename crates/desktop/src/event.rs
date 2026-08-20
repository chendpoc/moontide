use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use agent::ProgressEvent;
use tokio::sync::Notify;

use crate::{
    state::{DeliveryStatus, ResyncReason, ShutdownReport},
    ApprovalRequest,
};

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

    /// Adapts the D1 in-process event stream to the top-level protocol envelope.
    pub async fn recv_protocol(
        &mut self,
        connection_epoch: crate::protocol::ConnectionEpoch,
    ) -> Option<crate::protocol::DesktopMessageEnvelope> {
        self.recv().await.map(|event| {
            crate::protocol::DesktopMessageEnvelope::from_event_envelope(event, connection_epoch)
        })
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

fn lock_state(state: &Mutex<BufferState>) -> std::sync::MutexGuard<'_, BufferState> {
    state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::llm::protocol::{ContentBlock, ModelResponseSnapshot};

    fn snapshot(text: &str) -> ModelResponseSnapshot {
        ModelResponseSnapshot {
            content: vec![ContentBlock::Text {
                text: text.to_owned(),
            }],
            pending: None,
            stop_reason: None,
            usage: None,
            model: None,
        }
    }

    // 场景：同一个 LLM call 连续产生两个完整 snapshot。
    // 预期：队列位置和 seq 保持不变，只交付最新 snapshot；不变量：不追加重复 draft。
    #[tokio::test]
    async fn snapshot_updates_are_coalesced_in_place() {
        let buffer = EventBuffer::new(16);
        buffer.publish(
            "session",
            DesktopEvent::Progress {
                event: ProgressEvent::AssistantResponseSnapshot {
                    turn: 0,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 0,
                    snapshot: snapshot("Hel"),
                },
            },
        );
        buffer.publish(
            "session",
            DesktopEvent::Progress {
                event: ProgressEvent::AssistantResponseSnapshot {
                    turn: 0,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 1,
                    snapshot: snapshot("Hello"),
                },
            },
        );

        let event = buffer.recv().await.expect("coalesced event");
        assert_eq!(event.seq, 1);
        assert!(matches!(
            event.payload,
            DesktopEvent::Progress {
                event: ProgressEvent::AssistantResponseSnapshot {
                    update_index: 1,
                    ..
                }
            }
        ));
    }

    // 场景：公开 DesktopEventStream adapter 从 EventBuffer 接收一个事件。
    // 预期：返回 protocol envelope，并保留 seq、connection_epoch 和语义事件。
    // 不变量：adapter 不改变事件 delivery identity 或事件顺序。
    #[tokio::test]
    async fn recv_protocol_adapts_public_stream() {
        let buffer = EventBuffer::new(16);
        buffer.publish(
            "session",
            DesktopEvent::StateChanged {
                state: crate::DesktopRunState::Idle,
            },
        );

        let mut stream = DesktopEventStream::new(buffer);
        let message = stream
            .recv_protocol(crate::protocol::ConnectionEpoch(9))
            .await
            .expect("protocol event");

        assert_eq!(
            message.connection_epoch,
            Some(crate::protocol::ConnectionEpoch(9))
        );
        assert_eq!(message.seq, Some(crate::protocol::Seq(1)));
        assert!(matches!(
            message.payload,
            crate::protocol::DesktopMessage::Event(
                crate::protocol::DesktopProtocolEvent::StateChanged {
                    state: crate::DesktopRunState::Idle
                }
            )
        ));
    }

    // 场景：control event 与 snapshot event 交错发布。
    // 预期：单一 EventBuffer 按接收顺序保持递增 seq；不变量：不存在双 lane 逆序。
    #[tokio::test]
    async fn control_and_snapshot_events_have_one_order() {
        let buffer = EventBuffer::new(16);
        buffer.publish(
            "session",
            DesktopEvent::StateChanged {
                state: crate::DesktopRunState::Idle,
            },
        );
        buffer.publish(
            "session",
            DesktopEvent::Progress {
                event: ProgressEvent::AssistantResponseSnapshot {
                    turn: 0,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 0,
                    snapshot: snapshot("hello"),
                },
            },
        );
        buffer.publish(
            "session",
            DesktopEvent::TurnFailed {
                turn: 0,
                error: crate::DesktopError {
                    kind: crate::DesktopErrorKind::Provider,
                    message: "failed".into(),
                    recoverable: true,
                },
            },
        );

        assert_eq!(buffer.recv().await.expect("first event").seq, 1);
        assert_eq!(buffer.recv().await.expect("second event").seq, 2);
        assert_eq!(buffer.recv().await.expect("third event").seq, 3);
    }

    // 场景：有界队列已被 control events 填满后继续发送 snapshot。
    // 预期：snapshot 被计数并设置 resync marker；不变量：事件丢失对 frontend 可见。
    #[tokio::test]
    async fn snapshot_overflow_sets_resync_status() {
        let buffer = EventBuffer::new(16);
        for turn in 0..16 {
            buffer.publish(
                "session",
                DesktopEvent::TurnFailed {
                    turn,
                    error: crate::DesktopError {
                        kind: crate::DesktopErrorKind::Provider,
                        message: "failed".into(),
                        recoverable: true,
                    },
                },
            );
        }
        let accepted = buffer.publish(
            "session",
            DesktopEvent::Progress {
                event: ProgressEvent::AssistantResponseSnapshot {
                    turn: 0,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 0,
                    snapshot: snapshot("hello"),
                },
            },
        );
        assert!(!accepted);
        let status = buffer.status();
        assert!(status.resync_required);
        assert_eq!(status.dropped_snapshots, 1);
    }
}
