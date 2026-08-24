use std::path::PathBuf;

use agent_core::{
    llm::protocol::{ContentBlock, ModelResponseSnapshot},
    tools::ToolContent,
};
use serde_json::json;

use super::*;
use crate::protocol::{
    ConnectionEpoch, DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent, DesktopResponse,
    Seq, DESKTOP_PROTOCOL_VERSION,
};
use crate::{ApprovalRequest, DesktopRunState, DesktopSnapshot, ShutdownReport};

fn event(seq: u64, payload: DesktopProtocolEvent) -> DesktopMessageEnvelope {
    DesktopMessageEnvelope {
        protocol_version: DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: None,
        seq: Some(Seq(seq)),
        payload: DesktopMessage::Event(payload),
    }
}

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

fn call(id: &str) -> agent::ToolCall {
    agent::ToolCall::new(id, "grep", json!({"pattern": "hello"})).expect("valid tool call")
}

fn desktop_snapshot() -> DesktopSnapshot {
    DesktopSnapshot {
        session: agent::SessionSnapshot {
            summary: agent::SessionSummary {
                session_id: "session-1".into(),
                cwd: PathBuf::from("/tmp"),
                last_turn: None,
                item_count: 0,
            },
            items: Vec::new(),
        },
        state: DesktopRunState::Idle,
        pending_approvals: Vec::new(),
        active_assistant_calls: Vec::new(),
        delivery: crate::DeliveryStatus {
            last_delivered_seq: 0,
            resync_required: true,
            dropped_snapshots: 1,
            buffered_events: 0,
        },
    }
}

// 场景：同一个 LLM call 发送多个 snapshot，并出现 seq gap。
// 预期：snapshot 按 key 替换，旧 update 被忽略，gap 请求 resync。
// 不变量：不追加重复 draft，也不猜测丢失的中间事件。
#[test]
fn snapshot_replaces_and_seq_gap_requests_resync() {
    let mut state = RenderState::default();
    let key = AssistantDraftKey {
        turn: 1,
        llm_call_id: "call-1".into(),
    };

    assert_eq!(
        state.apply_message(event(
            1,
            DesktopProtocolEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 1,
                snapshot: snapshot("Hello"),
            },
        )),
        RenderFoldResult::Applied
    );
    assert_eq!(
        state.assistant_drafts[&key].snapshot.content,
        snapshot("Hello").content
    );

    assert_eq!(
        state.apply_message(event(
            2,
            DesktopProtocolEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 0,
                snapshot: snapshot("stale"),
            },
        )),
        RenderFoldResult::Ignored
    );
    assert_eq!(
        state.assistant_drafts[&key].snapshot.content,
        snapshot("Hello").content
    );

    assert_eq!(
        state.apply_message(event(4, DesktopProtocolEvent::TurnEnded { turn: 1 })),
        RenderFoldResult::ResyncRequired
    );
    assert!(state.delivery.resync_required);
}

// 场景：assistant finalized 到达后再次收到同一 call 的 snapshot/finalized。
// 预期：draft 被移除，历史只增加一条 finalized message，重复事件被忽略。
// 不变量：finalized call 不会重新显示 transient draft。
#[test]
fn finalized_call_is_removed_and_not_reopened() {
    let mut state = RenderState::default();
    state.apply_message(event(
        1,
        DesktopProtocolEvent::AssistantResponseSnapshot {
            turn: 1,
            step: 0,
            llm_call_id: "call-1".into(),
            update_index: 1,
            snapshot: snapshot("done"),
        },
    ));
    assert_eq!(
        state.apply_message(event(
            2,
            DesktopProtocolEvent::AssistantFinalized {
                turn: 1,
                llm_call_id: "call-1".into(),
                blocks: vec![ContentBlock::Text {
                    text: "done".into(),
                }],
            },
        )),
        RenderFoldResult::Applied
    );
    assert!(state.assistant_drafts.is_empty());
    assert_eq!(state.messages.len(), 1);
    assert_eq!(
        state.apply_message(event(
            3,
            DesktopProtocolEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 2,
                snapshot: snapshot("again"),
            },
        )),
        RenderFoldResult::Ignored
    );
    assert!(state.assistant_drafts.is_empty());
    assert_eq!(state.messages.len(), 1);
}

// 场景：ToolResult 没有已知的 ToolCall，或名称与 ToolCall 不一致。
// 预期：不创建孤立 ToolView，并请求 resync。
// 不变量：UI 不猜测工具事实，也不把未知结果显示为成功。
#[test]
fn orphan_tool_result_requests_resync() {
    let mut state = RenderState::default();
    let unknown = agent::ToolResult::succeeded(&call("call-1"), ToolContent::Text("ok".into()));

    assert_eq!(
        state.apply_message(event(
            1,
            DesktopProtocolEvent::ToolResult {
                turn: 1,
                result: unknown,
            },
        )),
        RenderFoldResult::ResyncRequired
    );
    assert!(state.tools.is_empty());
    assert!(state.delivery.resync_required);
}

// 场景：Host 返回完整 DesktopSnapshot 作为 resync 基线。
// 预期：替换 history/run/approval/delivery，只保留仍 active 的 transient draft。
// 不变量：snapshot 成为新的 UI 基线，不 replay 已无法证明 active 的旧 draft。
#[test]
fn snapshot_replaces_render_baseline() {
    let mut state = RenderState::default();
    state.apply_message(event(
        1,
        DesktopProtocolEvent::AssistantResponseSnapshot {
            turn: 1,
            step: 0,
            llm_call_id: "call-1".into(),
            update_index: 1,
            snapshot: snapshot("transient"),
        },
    ));
    let result = state.apply_message(DesktopMessageEnvelope {
        protocol_version: DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: None,
        seq: None,
        payload: DesktopMessage::Response(DesktopResponse::Snapshot {
            snapshot: desktop_snapshot(),
        }),
    });

    assert_eq!(result, RenderFoldResult::Applied);
    assert!(state.session.is_some());
    assert!(state.assistant_drafts.is_empty());
    assert_eq!(state.run, DesktopRunState::Idle);
    assert_eq!(state.delivery.last_seq, Some(Seq(0)));
    assert!(!state.delivery.resync_required);

    let report = ShutdownReport {
        cancelled_turn: Some(1),
        progress_flushed: true,
        diagnostic_log_flushed: true,
    };
    assert_eq!(
        state.apply_message(event(
            1,
            DesktopProtocolEvent::Stopped {
                report: report.clone(),
            },
        )),
        RenderFoldResult::Applied
    );
    assert_eq!(state.stopped_report, Some(report));
}

// 场景：resync 时本地有两个 transient draft，但 Host 只确认其中一个 call 仍 active。
// 预期：保留 active draft，删除无法证明 active 的 draft，并显示可恢复 notice。
// 不变量：snapshot 不把未知 transient 内容重新写入 Session history。
#[test]
fn snapshot_preserves_only_active_drafts() {
    let mut state = RenderState::default();
    for (seq, call_id) in [(1, "call-1"), (2, "call-2")] {
        assert_eq!(
            state.apply_message(event(
                seq,
                DesktopProtocolEvent::AssistantResponseSnapshot {
                    turn: 1,
                    step: 0,
                    llm_call_id: call_id.into(),
                    update_index: 0,
                    snapshot: snapshot(call_id),
                },
            )),
            RenderFoldResult::Applied
        );
    }

    let mut baseline = desktop_snapshot();
    baseline.active_assistant_calls = vec![crate::ActiveAssistantCall {
        turn: 1,
        llm_call_id: "call-1".into(),
    }];
    let result = state.apply_message(DesktopMessageEnvelope {
        protocol_version: DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: None,
        seq: None,
        payload: DesktopMessage::Response(DesktopResponse::Snapshot { snapshot: baseline }),
    });

    assert_eq!(result, RenderFoldResult::Applied);
    assert!(state.assistant_drafts.contains_key(&AssistantDraftKey {
        turn: 1,
        llm_call_id: "call-1".into(),
    }));
    assert!(!state.assistant_drafts.contains_key(&AssistantDraftKey {
        turn: 1,
        llm_call_id: "call-2".into(),
    }));
    assert!(state
        .notices
        .iter()
        .any(|notice| notice.kind == NoticeKind::Resync && notice.recoverable));
}

// 场景：已有连接收到更高 connection_epoch 的事件，但新连接尚未发送 snapshot。
// 预期：事件不被折叠，UI 标记等待 snapshot；snapshot 到达后才接受新 epoch 事件。
// 不变量：新连接不会把缺失的历史事件混入旧 RenderState，也不会以 seq=1 绕过基线。
#[test]
fn new_epoch_requires_snapshot_before_events() {
    let mut state = RenderState::default();
    assert_eq!(
        state.apply_message(event(1, DesktopProtocolEvent::TurnStarted { turn: 1 })),
        RenderFoldResult::Applied
    );

    let new_epoch_event = DesktopMessageEnvelope {
        protocol_version: DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(2)),
        request_id: None,
        seq: Some(Seq(1)),
        payload: DesktopMessage::Event(DesktopProtocolEvent::TurnStarted { turn: 2 }),
    };
    assert_eq!(
        state.apply_message(new_epoch_event),
        RenderFoldResult::ResyncRequired
    );
    assert_eq!(state.run, DesktopRunState::Thinking { turn: 1, step: 0 });
    assert!(state.delivery.awaiting_snapshot);

    let snapshot = DesktopMessageEnvelope {
        protocol_version: DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(2)),
        request_id: None,
        seq: None,
        payload: DesktopMessage::Response(DesktopResponse::Snapshot {
            snapshot: desktop_snapshot(),
        }),
    };
    assert_eq!(state.apply_message(snapshot), RenderFoldResult::Applied);
    assert!(!state.delivery.awaiting_snapshot);
    assert_eq!(
        state.apply_message(DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(2)),
            request_id: None,
            seq: Some(Seq(1)),
            payload: DesktopMessage::Event(DesktopProtocolEvent::TurnStarted { turn: 2 }),
        }),
        RenderFoldResult::Applied
    );
    assert_eq!(state.run, DesktopRunState::Thinking { turn: 2, step: 0 });
}

// 场景：一轮 turn 已经发送 TurnCompleted，但成功路径没有额外 StateChanged(Idle)。
// 预期：RenderState 将 loading 状态折叠回 Idle。
// 不变量：UI 不会因忽略 lifecycle completion 而永久显示忙碌状态。
#[test]
fn turn_completed_returns_to_idle() {
    let mut state = RenderState::default();
    assert_eq!(
        state.apply_message(event(
            1,
            DesktopProtocolEvent::StateChanged {
                state: DesktopRunState::Thinking { turn: 1, step: 0 },
            },
        )),
        RenderFoldResult::Applied
    );
    assert_eq!(
        state.apply_message(event(2, DesktopProtocolEvent::TurnCompleted { turn: 1 })),
        RenderFoldResult::Applied
    );
    assert_eq!(state.run, DesktopRunState::Idle);
}

// 场景：ToolCall、ApprovalRequested、ToolResult 和 TurnFailed 按顺序到达。
// 预期：分别建立工具/approval projection，配对结果，并保留可恢复错误 notice。
// 不变量：approval 只由 request id 标识，ToolResult 只更新已知 ToolCall。
#[test]
fn tool_approval_result_and_failure_are_projected() {
    let mut state = RenderState::default();
    let tool_call = call("call-1");
    assert_eq!(
        state.apply_message(event(
            1,
            DesktopProtocolEvent::ToolCall {
                turn: 1,
                call: tool_call.clone(),
            },
        )),
        RenderFoldResult::Applied
    );

    let approval = ApprovalRequest {
        id: "approval-1".into(),
        turn: 1,
        call: tool_call.clone(),
        working_dir: PathBuf::from("/tmp"),
    };
    assert_eq!(
        state.apply_message(event(
            2,
            DesktopProtocolEvent::ApprovalRequested { request: approval },
        )),
        RenderFoldResult::Applied
    );
    assert!(state.approvals.contains_key("approval-1"));
    assert_eq!(
        state.run,
        DesktopRunState::WaitingApproval {
            turn: 1,
            request_id: "approval-1".into(),
        }
    );

    let accepted = DesktopMessageEnvelope {
        protocol_version: DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: Some(crate::RequestId("request-1".into())),
        seq: None,
        payload: DesktopMessage::Response(DesktopResponse::ApprovalAccepted {
            approval_id: "approval-1".into(),
        }),
    };
    assert_eq!(state.apply_message(accepted), RenderFoldResult::Applied);
    assert!(state.approvals.is_empty());

    let result = agent::ToolResult::succeeded(&tool_call, ToolContent::Text("ok".into()));
    assert_eq!(
        state.apply_message(event(
            3,
            DesktopProtocolEvent::ToolResult { turn: 1, result },
        )),
        RenderFoldResult::Applied
    );
    assert!(state.tools["call-1"].result.is_some());

    let error = crate::DesktopError {
        kind: crate::DesktopErrorKind::Tool,
        message: "tool failed after approval".into(),
        recoverable: true,
    };
    assert_eq!(
        state.apply_message(event(
            4,
            DesktopProtocolEvent::TurnFailed { turn: 1, error },
        )),
        RenderFoldResult::Applied
    );
    assert!(matches!(
        state.run,
        DesktopRunState::Failed { turn: Some(1), .. }
    ));
    assert!(state.notices.iter().any(|notice| {
        notice.kind == NoticeKind::Error && notice.error_kind == Some(crate::DesktopErrorKind::Tool)
    }));
}

// 场景：UI command 分别返回可继续处理的输入错误和不可恢复的 host lifecycle 错误。
// 预期：notice 保留正确的 recoverable 语义，避免把 Stopped/内部错误显示为可重试。
// 不变量：command error 只进入 UI notice，不改变 RenderState 的运行事实。
#[test]
fn command_error_notice_preserves_recoverability() {
    let mut state = RenderState::default();

    state.record_command_error(crate::DesktopCommandError::InvalidInput("empty".into()));
    state.record_command_error(crate::DesktopCommandError::Stopped);

    assert!(state.notices[0].recoverable);
    assert!(!state.notices[1].recoverable);
    assert_eq!(state.run, DesktopRunState::Starting);
}
