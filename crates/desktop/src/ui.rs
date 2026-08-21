use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use iced::futures::{SinkExt, Stream};
use iced::widget::{button, column, container, row, scrollable, text, text_input};
use iced::{Element, Fill, FillPortion, Subscription, Task, Theme};

use crate::protocol::{ConnectionEpoch, DesktopMessageEnvelope};
use crate::render_state::{
    AssistantDraftKey, MessageView, RenderFoldResult, RenderState, ToolView,
};
use crate::{DesktopCommandError, DesktopEventStream, DesktopHostHandle, DesktopSnapshot};

/// Runs the injected Desktop UI shell. Agent configuration and Host startup stay outside D3.
pub fn run_ui(
    host: DesktopHostHandle,
    events: DesktopEventStream,
    connection_epoch: ConnectionEpoch,
) -> iced::Result {
    let host = Arc::new(host);
    let event_source = ProtocolSource::new(events, connection_epoch);

    iced::application(
        move || {
            let state = UiState::new(Arc::clone(&host), event_source.clone());
            (state, snapshot_task(Arc::clone(&host)))
        },
        update,
        view,
    )
    .title("MoonTide")
    .theme(theme)
    .subscription(subscription)
    .run()
}

#[derive(Debug, Clone)]
enum UiMessage {
    Protocol(DesktopMessageEnvelope),
    InputChanged(String),
    Submit,
    Submitted {
        text: String,
        result: Result<u64, DesktopCommandError>,
    },
    Stop,
    StopCompleted(Result<(), DesktopCommandError>),
    ToggleInspector,
    SelectTool(String),
    SelectApproval(String),
    SelectThinking {
        turn: u64,
        llm_call_id: String,
    },
    ToggleThinking,
    Approve(String),
    Deny(String),
    ApprovalCompleted {
        approval_id: String,
        result: Result<(), DesktopCommandError>,
    },
    SnapshotLoaded(Result<DesktopSnapshot, DesktopCommandError>),
}

struct UiState {
    host: Arc<DesktopHostHandle>,
    event_source: ProtocolSource,
    render_state: RenderState,
    input: String,
    snapshot_in_flight: bool,
    pending_protocol_events: VecDeque<DesktopMessageEnvelope>,
    inspector_open: bool,
    inspector_selection: Option<InspectorSelection>,
    thinking_expanded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum InspectorSelection {
    Tool { tool_use_id: String },
    Approval { approval_id: String },
    Thinking { turn: u64, llm_call_id: String },
}

impl UiState {
    fn new(host: Arc<DesktopHostHandle>, event_source: ProtocolSource) -> Self {
        Self {
            host,
            event_source,
            render_state: RenderState::default(),
            input: String::new(),
            snapshot_in_flight: true,
            pending_protocol_events: VecDeque::new(),
            inspector_open: false,
            inspector_selection: None,
            thinking_expanded: false,
        }
    }
}

#[derive(Clone)]
struct ProtocolSource {
    stream: Arc<Mutex<Option<DesktopEventStream>>>,
    connection_epoch: ConnectionEpoch,
}

impl ProtocolSource {
    fn new(stream: DesktopEventStream, connection_epoch: ConnectionEpoch) -> Self {
        Self {
            stream: Arc::new(Mutex::new(Some(stream))),
            connection_epoch,
        }
    }

    fn take_stream(&self) -> Option<DesktopEventStream> {
        self.stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }
}

impl Hash for ProtocolSource {
    fn hash<H: Hasher>(&self, state: &mut H) {
        Arc::as_ptr(&self.stream).hash(state);
        self.connection_epoch.hash(state);
    }
}

fn subscription(state: &UiState) -> Subscription<UiMessage> {
    Subscription::run_with(state.event_source.clone(), protocol_stream).map(UiMessage::Protocol)
}

fn theme(_: &UiState) -> Theme {
    Theme::Dark
}

fn protocol_stream(source: &ProtocolSource) -> impl Stream<Item = DesktopMessageEnvelope> {
    let source = source.clone();
    iced::stream::channel(32, async move |mut output| {
        let Some(mut events) = source.take_stream() else {
            return;
        };

        while let Some(message) = events.recv_protocol(source.connection_epoch).await {
            if output.send(message).await.is_err() {
                break;
            }
        }
    })
}

fn update(state: &mut UiState, message: UiMessage) -> Task<UiMessage> {
    match message {
        UiMessage::Protocol(envelope) => {
            if state.snapshot_in_flight {
                state.pending_protocol_events.push_back(envelope);
                Task::none()
            } else {
                apply_protocol_message(state, envelope)
            }
        }
        UiMessage::InputChanged(input) => {
            state.input = input;
            Task::none()
        }
        UiMessage::Submit => {
            let text = std::mem::take(&mut state.input);
            if text.trim().is_empty() {
                state.input = text;
                return Task::none();
            }

            let host = Arc::clone(&state.host);
            Task::perform(
                async move {
                    let result = host.submit_turn(text.clone()).await;
                    (text, result)
                },
                |(text, result)| UiMessage::Submitted { text, result },
            )
        }
        UiMessage::Submitted { text, result } => {
            if let Err(error) = result {
                state.input = text;
                state.render_state.record_command_error(error);
            }
            Task::none()
        }
        UiMessage::Stop => {
            let host = Arc::clone(&state.host);
            Task::perform(
                async move { host.cancel_turn().await },
                UiMessage::StopCompleted,
            )
        }
        UiMessage::StopCompleted(result) => {
            if let Err(error) = result {
                state.render_state.record_command_error(error);
            }
            Task::none()
        }
        UiMessage::ToggleInspector => {
            state.inspector_open = !state.inspector_open;
            Task::none()
        }
        UiMessage::SelectTool(tool_use_id) => {
            state.inspector_selection = Some(InspectorSelection::Tool { tool_use_id });
            state.inspector_open = true;
            Task::none()
        }
        UiMessage::SelectApproval(approval_id) => {
            state.inspector_selection = Some(InspectorSelection::Approval { approval_id });
            state.inspector_open = true;
            Task::none()
        }
        UiMessage::SelectThinking { turn, llm_call_id } => {
            state.inspector_selection = Some(InspectorSelection::Thinking { turn, llm_call_id });
            state.inspector_open = true;
            Task::none()
        }
        UiMessage::ToggleThinking => {
            state.thinking_expanded = !state.thinking_expanded;
            Task::none()
        }
        UiMessage::Approve(approval_id) => {
            let host = Arc::clone(&state.host);
            let id = approval_id.clone();
            Task::perform(
                async move { host.approve(approval_id).await },
                move |result| UiMessage::ApprovalCompleted {
                    approval_id: id,
                    result,
                },
            )
        }
        UiMessage::Deny(approval_id) => {
            let host = Arc::clone(&state.host);
            let id = approval_id.clone();
            Task::perform(
                async move { host.deny(approval_id, "denied by user".into()).await },
                move |result| UiMessage::ApprovalCompleted {
                    approval_id: id,
                    result,
                },
            )
        }
        UiMessage::ApprovalCompleted {
            approval_id,
            result,
        } => {
            match result {
                Ok(()) => {
                    state.render_state.approvals.remove(&approval_id);
                }
                Err(error) => state.render_state.record_command_error(error),
            }
            Task::none()
        }
        UiMessage::SnapshotLoaded(result) => {
            state.snapshot_in_flight = false;
            match result {
                Ok(snapshot) => state.render_state.replace_snapshot(snapshot),
                Err(error) => state.render_state.record_command_error(error),
            }
            let fold_result = replay_pending_protocol_events(
                &mut state.render_state,
                &mut state.pending_protocol_events,
            );
            if fold_result == RenderFoldResult::ResyncRequired {
                state.snapshot_in_flight = true;
                snapshot_task(Arc::clone(&state.host))
            } else {
                Task::none()
            }
        }
    }
}

fn apply_protocol_message(
    state: &mut UiState,
    envelope: DesktopMessageEnvelope,
) -> Task<UiMessage> {
    let result = state.render_state.apply_message(envelope);
    if result == RenderFoldResult::ResyncRequired && !state.snapshot_in_flight {
        state.snapshot_in_flight = true;
        snapshot_task(Arc::clone(&state.host))
    } else {
        Task::none()
    }
}

fn replay_pending_protocol_events(
    render_state: &mut RenderState,
    pending: &mut VecDeque<DesktopMessageEnvelope>,
) -> RenderFoldResult {
    while let Some(envelope) = pending.pop_front() {
        let result = render_state.apply_message(envelope);
        if result == RenderFoldResult::ResyncRequired {
            return result;
        }
    }
    RenderFoldResult::Applied
}

fn snapshot_task(host: Arc<DesktopHostHandle>) -> Task<UiMessage> {
    Task::perform(
        async move { host.snapshot().await },
        UiMessage::SnapshotLoaded,
    )
}

fn view(state: &UiState) -> Element<'_, UiMessage> {
    let notices = state
        .render_state
        .notices
        .iter()
        .map(|notice| text(format!("{:?}: {}", notice.kind, notice.message)).into())
        .collect::<Vec<Element<'_, UiMessage>>>();

    let mut messages = state
        .render_state
        .messages
        .iter()
        .map(message_view)
        .collect::<Vec<_>>();
    messages.extend(state.render_state.assistant_drafts.values().map(|draft| {
        row![
            text(format!(
                "assistant (draft): {}",
                snapshot_text(&draft.snapshot)
            )),
            button("Thinking").on_press(UiMessage::SelectThinking {
                turn: draft.key.turn,
                llm_call_id: draft.key.llm_call_id.clone(),
            }),
        ]
        .spacing(8)
        .into()
    }));

    let historical_tool_ids = state
        .render_state
        .messages
        .iter()
        .filter_map(|message| match message {
            MessageView::ToolCall { call, .. } => Some(call.tool_use_id().to_owned()),
            MessageView::ToolResult { result, .. } => Some(result.tool_use_id().to_owned()),
            _ => None,
        })
        .collect::<std::collections::BTreeSet<_>>();
    messages.extend(
        state
            .render_state
            .tools
            .values()
            .filter(|tool| !historical_tool_ids.contains(tool.call.tool_use_id()))
            .map(tool_view),
    );

    let approvals = state
        .render_state
        .approvals
        .values()
        .map(|approval| {
            row![
                button(text(format!("approval: {}", approval.request.call.name())))
                    .on_press(UiMessage::SelectApproval(approval.request.id.clone())),
                button("Allow").on_press(UiMessage::Approve(approval.request.id.clone())),
                button("Deny").on_press(UiMessage::Deny(approval.request.id.clone())),
            ]
            .spacing(8)
            .into()
        })
        .collect::<Vec<Element<'_, UiMessage>>>();

    let conversation = scrollable(column(messages).spacing(8))
        .width(FillPortion(3))
        .height(Fill);
    let composer = row![
        text_input("Message", &state.input)
            .on_input(UiMessage::InputChanged)
            .on_submit(UiMessage::Submit)
            .width(Fill),
        button("Send").on_press(UiMessage::Submit),
        button("Stop").on_press(UiMessage::Stop),
    ]
    .spacing(8);

    let content: Element<'_, UiMessage> = if state.inspector_open {
        row![conversation, inspector_view(state)]
            .spacing(12)
            .height(Fill)
            .into()
    } else {
        conversation.into()
    };

    container(
        column![
            row![
                text(format!("MoonTide · {:?}", state.render_state.run)).width(Fill),
                button(if state.inspector_open {
                    "Hide Inspector"
                } else {
                    "Inspector"
                })
                .on_press(UiMessage::ToggleInspector),
            ]
            .spacing(8),
            column(notices).spacing(4),
            content,
            column(approvals).spacing(8),
            composer,
        ]
        .spacing(12)
        .padding(16),
    )
    .width(Fill)
    .height(Fill)
    .into()
}

fn message_view(message: &MessageView) -> Element<'static, UiMessage> {
    let label = match message {
        MessageView::User { text, .. } => format!("user: {text}"),
        MessageView::Assistant { blocks, .. } => {
            format!("assistant: {}", blocks_text(blocks))
        }
        MessageView::ToolCall { call, .. } => {
            return button(text(format!("tool call: {}", call.name())))
                .on_press(UiMessage::SelectTool(call.tool_use_id().to_owned()))
                .into();
        }
        MessageView::ToolResult { result, .. } => {
            return button(text(format!(
                "tool result: {} ({:?})",
                result.name(),
                result.status()
            )))
            .on_press(UiMessage::SelectTool(result.tool_use_id().to_owned()))
            .into();
        }
    };
    text(label).into()
}

fn tool_view(tool: &ToolView) -> Element<'static, UiMessage> {
    button(text(tool_label(tool)))
        .on_press(UiMessage::SelectTool(tool.call.tool_use_id().to_owned()))
        .into()
}

fn tool_label(tool: &ToolView) -> String {
    let result = match &tool.result {
        Some(result) => format!("{:?}", result.status()),
        None => "running".into(),
    };
    format!("tool: {} ({})", tool.call.name(), result)
}

fn inspector_view(state: &UiState) -> Element<'_, UiMessage> {
    let body = match state.inspector_selection.as_ref() {
        Some(InspectorSelection::Tool { tool_use_id }) => tool_inspector(state, tool_use_id),
        Some(InspectorSelection::Approval { approval_id }) => {
            approval_inspector(state, approval_id)
        }
        Some(InspectorSelection::Thinking { turn, llm_call_id }) => {
            thinking_inspector(state, *turn, llm_call_id)
        }
        None => text("Select a tool, approval, or thinking item.").into(),
    };

    container(column![text("Inspector"), body].spacing(8).padding(12))
        .width(FillPortion(2))
        .height(Fill)
        .into()
}

fn tool_inspector(state: &UiState, tool_use_id: &str) -> Element<'static, UiMessage> {
    let Some(tool) = state.render_state.tools.get(tool_use_id) else {
        return text("Tool is no longer present in the current RenderState.").into();
    };

    let result = tool
        .result
        .as_ref()
        .map(|result| format!("{:?}: {:?}", result.status(), result.content()))
        .unwrap_or_else(|| "running".into());
    column![
        text(format!("Tool: {}", tool.call.name())),
        text(format!("Turn: {}", tool.turn)),
        text(format!("Tool use id: {}", tool.call.tool_use_id())),
        text(format!("Input: {:?}", tool.call.input())),
        text(format!("Result: {result}")),
    ]
    .spacing(6)
    .into()
}

fn approval_inspector(state: &UiState, approval_id: &str) -> Element<'static, UiMessage> {
    let Some(approval) = state.render_state.approvals.get(approval_id) else {
        return text("Approval is no longer pending.").into();
    };

    column![
        text(format!("Approval: {}", approval.request.id)),
        text(format!("Turn: {}", approval.request.turn)),
        text(format!("Tool: {}", approval.request.call.name())),
        text(format!("Input: {:?}", approval.request.call.input())),
        text(format!(
            "Working directory: {}",
            approval.request.working_dir.display()
        )),
        row![
            button("Allow").on_press(UiMessage::Approve(approval.request.id.clone())),
            button("Deny").on_press(UiMessage::Deny(approval.request.id.clone())),
        ]
        .spacing(8),
    ]
    .spacing(6)
    .into()
}

fn thinking_inspector(
    state: &UiState,
    turn: u64,
    llm_call_id: &str,
) -> Element<'static, UiMessage> {
    let key = AssistantDraftKey {
        turn,
        llm_call_id: llm_call_id.to_owned(),
    };
    let Some(draft) = state.render_state.assistant_drafts.get(&key) else {
        return text("Assistant draft is no longer present in the current RenderState.").into();
    };

    let content = if state.thinking_expanded {
        thinking_text(&draft.snapshot)
    } else {
        "Thinking is collapsed.".into()
    };
    column![
        text(format!("Thinking · turn {turn} · call {llm_call_id}")),
        text(content),
        button(if state.thinking_expanded {
            "Collapse thinking"
        } else {
            "Expand thinking"
        })
        .on_press(UiMessage::ToggleThinking),
    ]
    .spacing(6)
    .into()
}

fn blocks_text(blocks: &[agent::ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            agent::ContentBlock::Text { text } => Some(text.clone()),
            agent::ContentBlock::Thinking { .. } => None,
            agent::ContentBlock::ToolUse { name, .. } => Some(format!("tool: {name}")),
            agent::ContentBlock::ToolResult { .. } => Some("tool result".into()),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn snapshot_text(snapshot: &agent::ModelResponseSnapshot) -> String {
    snapshot
        .content
        .iter()
        .filter_map(|block| match block {
            agent::ContentBlock::Text { text } => Some(text.clone()),
            agent::ContentBlock::Thinking { .. } => None,
            agent::ContentBlock::ToolUse { name, .. } => Some(format!("tool: {name}")),
            agent::ContentBlock::ToolResult { .. } => Some("tool result".into()),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn thinking_text(snapshot: &agent::ModelResponseSnapshot) -> String {
    let thinking = snapshot
        .content
        .iter()
        .filter_map(|block| match block {
            agent::ContentBlock::Thinking { thinking } => Some(thinking.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    if thinking.is_empty() {
        "No thinking blocks in this draft.".into()
    } else {
        thinking.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DesktopRunState;
    use agent_core::llm::protocol::ContentBlock;

    // 场景：RenderState 中的 finalized assistant blocks 被最小 UI 文本视图读取。
    // 预期：文本和 tool use 保留可读摘要，thinking 默认不进入 Conversation，并按可见顺序连接。
    // 不变量：view helper 只读取 canonical payload，不修改 Session 或 RenderState。
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

        assert_eq!(blocks_text(&blocks), "answer\ntool: grep");
    }

    // 场景：Iced subscription 重新评估同一个协议事件源。
    // 预期：事件流只被一个订阅实例取走，重复启动不会创建第二个消费者。
    // 不变量：同一 DesktopEventStream 不被 UI 分裂消费，保持 EventBuffer 的单一顺序。
    #[test]
    fn protocol_source_is_consumed_once() {
        let events = DesktopEventStream::new(crate::event::EventBuffer::new(16));
        let source = ProtocolSource::new(events, ConnectionEpoch(1));

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

        let label = tool_label(&tool);
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
        render_state.replace_snapshot(DesktopSnapshot {
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
        });

        let mut pending = VecDeque::from([DesktopMessageEnvelope {
            protocol_version: crate::protocol::DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(1)),
            request_id: None,
            seq: Some(crate::protocol::Seq(1)),
            payload: crate::protocol::DesktopMessage::Event(
                crate::protocol::DesktopProtocolEvent::StateChanged {
                    state: DesktopRunState::Thinking { turn: 1, step: 0 },
                },
            ),
        }]);

        assert_eq!(
            replay_pending_protocol_events(&mut render_state, &mut pending),
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

        assert_eq!(snapshot_text(&snapshot), "answer");
        assert_eq!(thinking_text(&snapshot), "private reasoning");
    }
}
