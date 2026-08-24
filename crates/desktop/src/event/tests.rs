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

// 场景：EventBuffer 观察到 assistant snapshot、成功结束和 finalized 生命周期。
// 预期：成功 call 在 finalized 前仍被标记 active，finalized 后从 snapshot metadata 移除。
// 不变量：DesktopSnapshot 只暴露 transient draft 的最小 identity，不复制 draft 内容。
#[tokio::test]
async fn active_assistant_calls_follow_progress_lifecycle() {
    let buffer = EventBuffer::new(16);
    buffer.publish(
        "session",
        DesktopEvent::Progress {
            event: ProgressEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 0,
                snapshot: snapshot("partial"),
            },
        },
    );
    assert_eq!(
        buffer.active_assistant_calls(),
        vec![crate::ActiveAssistantCall {
            turn: 1,
            llm_call_id: "call-1".into(),
        }]
    );

    buffer.publish(
        "session",
        DesktopEvent::Progress {
            event: ProgressEvent::LlmCallEnded {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                outcome: agent::LlmCallOutcome::Succeeded {
                    stop_reason: agent::StopReason::EndTurn,
                    usage: None,
                },
            },
        },
    );
    assert_eq!(buffer.active_assistant_calls().len(), 1);

    buffer.publish(
        "session",
        DesktopEvent::Progress {
            event: ProgressEvent::AssistantFinalized {
                turn: 1,
                llm_call_id: "call-1".into(),
                blocks: vec![],
            },
        },
    );
    assert!(buffer.active_assistant_calls().is_empty());
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
