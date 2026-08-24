use std::collections::VecDeque;

use agent_core::llm::protocol::ContentBlock;

use super::{components, composer, sync, DesktopMessageEnvelope, RenderState};
use crate::protocol::{ConnectionEpoch, DesktopMessage};
use crate::render_state::{RenderFoldResult, ToolView};
use crate::{DesktopCommandError, DesktopEventStream, DesktopRunState, DesktopSnapshot};

fn test_snapshot() -> DesktopSnapshot {
    DesktopSnapshot {
        session: agent::SessionSnapshot {
            summary: agent::SessionSummary {
                session_id: "session-1".into(),
                cwd: std::path::PathBuf::from("/tmp"),
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
            resync_required: false,
            dropped_snapshots: 0,
            buffered_events: 0,
        },
    }
}

// 场景：RenderState 中的 finalized assistant blocks 被最小 UI 文本视图读取。
// 预期：文本和 tool use 保留可读摘要，thinking 默认不进入 Conversation，并按可见顺序连接。
// 不变量：component helper 只读取 canonical payload，不修改 Session 或 RenderState。
#[test]
fn blocks_text_hides_thinking_and_preserves_visible_order() {
    let blocks = vec![
        ContentBlock::Text {
            text: "answer".into(),
        },
        ContentBlock::Thinking {
            thinking: "reason".into(),
        },
        ContentBlock::ToolUse {
            id: "call-1".into(),
            name: "grep".into(),
            input: serde_json::json!({"pattern": "hello"}),
        },
    ];

    assert_eq!(
        components::cards::blocks_text(&blocks),
        "answer\ntool: grep"
    );
}

// 场景：Iced subscription 重新评估同一个协议事件源。
// 预期：事件流只被一个订阅实例取走，重复启动不会创建第二个消费者。
// 不变量：同一 DesktopEventStream 不被 UI 分裂消费，保持 EventBuffer 的单一顺序。
#[test]
fn protocol_source_is_consumed_once() {
    let events = DesktopEventStream::new(crate::event::EventBuffer::new(16));
    let source = sync::ProtocolSource::new(events, ConnectionEpoch(1));

    assert!(source.take_stream().is_some());
    assert!(source.take_stream().is_none());
}

// 场景：UI 读取 RenderState 中尚未出现在 Session history 的 live tool。
// 预期：工具名称和运行状态进入最小工具卡片，完整输入留给 Inspector。
// 不变量：helper 只读取 canonical ToolCall/ToolResult，不修改 Host 或 Session。
#[test]
fn tool_label_includes_live_call_state() {
    let call = agent::ToolCall::new("call-1", "grep", serde_json::json!({"pattern": "hello"}))
        .expect("valid tool call");
    let tool = ToolView {
        turn: 1,
        call: call.clone(),
        result: Some(agent::ToolResult::succeeded(
            &call,
            agent_core::tools::ToolContent::Text("ok".into()),
        )),
    };

    let label = components::cards::tool_label(&tool);
    assert!(label.contains("tool: grep"));
    assert!(label.contains("Succeeded"));
    assert!(!label.contains("hello"));
}

// 场景：初始 Snapshot 请求期间收到的事件在 Snapshot 返回后才重放。
// 预期：Snapshot 的 delivery baseline 先建立，seq=1 的排队事件随后正常应用，不制造伪 gap。
// 不变量：事件不会在 baseline 建立前直接修改 RenderState，也不会因 Snapshot 回退 last_seq。
#[test]
fn pending_events_replay_after_snapshot_baseline() {
    let mut render_state = RenderState::default();
    render_state.replace_snapshot(test_snapshot());

    let mut pending = VecDeque::from([DesktopMessageEnvelope {
        protocol_version: crate::protocol::DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: None,
        seq: Some(crate::protocol::Seq(1)),
        payload: DesktopMessage::Event(crate::protocol::DesktopProtocolEvent::StateChanged {
            state: DesktopRunState::Thinking { turn: 1, step: 0 },
        }),
    }]);

    assert_eq!(
        sync::replay_pending_protocol_events(&mut render_state, &mut pending),
        RenderFoldResult::Applied
    );
    assert!(pending.is_empty());
    assert_eq!(
        render_state.run,
        DesktopRunState::Thinking { turn: 1, step: 0 }
    );
    assert_eq!(
        render_state.delivery.last_seq,
        Some(crate::protocol::Seq(1))
    );
}

// 场景：assistant draft 同时包含 text 和 thinking blocks。
// 预期：Conversation 摘要隐藏 thinking，Inspector helper 单独提取 thinking 内容。
// 不变量：UI 只改变展示方式，不修改 canonical ModelResponseSnapshot。
#[test]
fn draft_summary_and_thinking_detail_are_separate() {
    let snapshot = agent::ModelResponseSnapshot {
        content: vec![
            ContentBlock::Thinking {
                thinking: "private reasoning".into(),
            },
            ContentBlock::Text {
                text: "answer".into(),
            },
        ],
        pending: None,
        stop_reason: None,
        usage: None,
        model: None,
    };

    assert_eq!(components::cards::snapshot_text(&snapshot), "answer");
    assert_eq!(
        components::cards::thinking_text(&snapshot),
        "private reasoning"
    );
}

// 场景：composer 收到普通 Enter、Cmd/Ctrl+Enter 和 Escape。
// 预期：普通 Enter 保留换行，命令组合键提交，Escape 交给 UI 关闭/取消逻辑。
// 不变量：快捷键只产生 UI intent，不直接调用 Host 或修改 Session。
#[test]
fn composer_key_bindings_preserve_multiline_and_shortcuts() {
    let key_press = |key, modifiers| iced::widget::text_editor::KeyPress {
        key,
        modified_key: iced::keyboard::Key::Named(iced::keyboard::key::Named::Enter),
        physical_key: iced::keyboard::key::Physical::Code(iced::keyboard::key::Code::Enter),
        modifiers,
        text: None,
        status: iced::widget::text_editor::Status::Focused { is_hovered: true },
    };

    assert!(matches!(
        composer::key_binding(key_press(
            iced::keyboard::Key::Named(iced::keyboard::key::Named::Enter),
            iced::keyboard::Modifiers::NONE,
        )),
        Some(iced::widget::text_editor::Binding::Enter)
    ));
    assert!(matches!(
        composer::key_binding(key_press(
            iced::keyboard::Key::Named(iced::keyboard::key::Named::Enter),
            iced::keyboard::Modifiers::COMMAND,
        )),
        Some(iced::widget::text_editor::Binding::Custom(
            super::UiMessage::Submit
        ))
    ));
    assert!(matches!(
        composer::key_binding(key_press(
            iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape),
            iced::keyboard::Modifiers::NONE,
        )),
        Some(iced::widget::text_editor::Binding::Custom(
            super::UiMessage::Escape
        ))
    ));
}

// 场景：全局键盘流收到未被 editor 捕获的 Escape 和重复按键。
// 预期：Escape 产生一次 UI intent，key repeat 不重复触发 Stop 或关闭 Inspector。
// 不变量：全局监听只消费 Escape，不劫持普通文本输入或提交组合键。
#[test]
fn global_keyboard_message_handles_escape_without_repeat() {
    let event = iced::keyboard::Event::KeyPressed {
        key: iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape),
        modified_key: iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape),
        physical_key: iced::keyboard::key::Physical::Code(iced::keyboard::key::Code::Escape),
        location: iced::keyboard::Location::Standard,
        modifiers: iced::keyboard::Modifiers::NONE,
        text: None,
        repeat: false,
    };
    assert!(matches!(
        composer::keyboard_message(event),
        Some(super::UiMessage::Escape)
    ));

    let repeated = iced::keyboard::Event::KeyPressed {
        key: iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape),
        modified_key: iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape),
        physical_key: iced::keyboard::key::Physical::Code(iced::keyboard::key::Code::Escape),
        location: iced::keyboard::Location::Standard,
        modifiers: iced::keyboard::Modifiers::NONE,
        text: None,
        repeat: true,
    };
    assert!(composer::keyboard_message(repeated).is_none());
}

// 场景：UI 处于 active Turn、Idle 或 Stopped 状态时判断 Escape 的优先动作。
// 预期：只有 Thinking、RunningTool 和 WaitingApproval 需要 cancel，其余状态关闭 Inspector。
// 不变量：UI 不重复 cancel Cancelling/Stopping，也不从文本内容猜测运行状态。
#[test]
fn active_turn_only_covers_cancellable_run_states() {
    assert!(composer::active_turn(&DesktopRunState::Thinking {
        turn: 1,
        step: 0
    }));
    assert!(composer::active_turn(&DesktopRunState::RunningTool {
        turn: 1,
        tool_use_id: "call-1".into(),
        name: "grep".into(),
    }));
    assert!(composer::active_turn(&DesktopRunState::WaitingApproval {
        turn: 1,
        request_id: "approval-1".into(),
    }));
    assert!(!composer::active_turn(&DesktopRunState::Idle));
    assert!(!composer::active_turn(&DesktopRunState::Cancelling {
        turn: 1
    }));
    assert!(!composer::active_turn(&DesktopRunState::Stopped));
}

// 场景：Snapshot 请求失败，但 UI 仍持有请求期间收到的 pending event。
// 预期：失败进入 Retry，不消费 pending event，也不建立 delivery baseline。
// 不变量：没有成功 Snapshot 时，第一条事件不能隐式成为 last_seq。
#[test]
fn failed_snapshot_retains_pending_events_for_retry() {
    let mut render_state = RenderState::default();
    let mut pending = VecDeque::from([DesktopMessageEnvelope {
        protocol_version: crate::protocol::DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: None,
        seq: Some(crate::protocol::Seq(1)),
        payload: DesktopMessage::Event(crate::protocol::DesktopProtocolEvent::StateChanged {
            state: DesktopRunState::Thinking { turn: 1, step: 0 },
        }),
    }]);
    let mut overflowed = false;

    assert_eq!(
        sync::apply_snapshot_result(
            &mut render_state,
            &mut pending,
            &mut overflowed,
            Err(DesktopCommandError::Internal("snapshot unavailable".into())),
        ),
        sync::SnapshotAction::Retry
    );
    assert_eq!(pending.len(), 1);
    assert_eq!(render_state.delivery.last_seq, None);
    assert_eq!(render_state.run, DesktopRunState::Starting);
}

// 场景：Snapshot 完成前 UI pending queue 已发生 overflow。
// 预期：成功 Snapshot 后丢弃不完整队列并重新请求 Snapshot，而不是 replay 截断事件。
// 不变量：overflow 后只能以新的权威 Snapshot 恢复，不能把部分事件当作完整增量。
#[test]
fn pending_overflow_requires_a_fresh_snapshot() {
    let mut render_state = RenderState::default();
    let mut pending = VecDeque::from([DesktopMessageEnvelope {
        protocol_version: crate::protocol::DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(ConnectionEpoch(1)),
        request_id: None,
        seq: Some(crate::protocol::Seq(1)),
        payload: DesktopMessage::Event(crate::protocol::DesktopProtocolEvent::StateChanged {
            state: DesktopRunState::Thinking { turn: 1, step: 0 },
        }),
    }]);
    let mut overflowed = true;

    assert_eq!(
        sync::apply_snapshot_result(
            &mut render_state,
            &mut pending,
            &mut overflowed,
            Ok(test_snapshot()),
        ),
        sync::SnapshotAction::Resync
    );
    assert!(pending.is_empty());
    assert!(!overflowed);
    assert_eq!(
        render_state.session.unwrap().summary.session_id,
        "session-1"
    );
}

// 场景：Composer 处于各个 Host 运行态或本地 command phase。
// 预期：mode 与 UI contract 一致，active Turn 只允许 Stop，Cancelling/Stopped 禁止操作。
// 不变量：view 与 update 共用同一 mode 判定，不依赖按钮是否被渲染来提供安全性。
#[test]
fn composer_modes_follow_run_and_command_phases() {
    assert_eq!(
        composer::mode_for(&DesktopRunState::Idle, false, false),
        composer::ComposerMode::Editable
    );
    assert_eq!(
        composer::mode_for(
            &DesktopRunState::Thinking { turn: 1, step: 0 },
            false,
            false
        ),
        composer::ComposerMode::Active
    );
    assert_eq!(
        composer::mode_for(&DesktopRunState::Idle, true, false),
        composer::ComposerMode::Submitting
    );
    assert_eq!(
        composer::mode_for(&DesktopRunState::Thinking { turn: 1, step: 0 }, false, true),
        composer::ComposerMode::Cancelling
    );
    assert_eq!(
        composer::mode_for(&DesktopRunState::Stopped, false, false),
        composer::ComposerMode::Disabled
    );
}
