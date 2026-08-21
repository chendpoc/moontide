use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use iced::futures::{SinkExt, Stream};
use iced::widget::{button, column, container, row, scrollable, text, text_input};
use iced::{Element, Fill, Subscription, Task, Theme};

use crate::protocol::{ConnectionEpoch, DesktopMessageEnvelope};
use crate::render_state::{MessageView, RenderFoldResult, RenderState, ToolView};
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
}

impl UiState {
    fn new(host: Arc<DesktopHostHandle>, event_source: ProtocolSource) -> Self {
        Self {
            host,
            event_source,
            render_state: RenderState::default(),
            input: String::new(),
            snapshot_in_flight: true,
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
            let result = state.render_state.apply_message(envelope);
            if result == RenderFoldResult::ResyncRequired && !state.snapshot_in_flight {
                state.snapshot_in_flight = true;
                snapshot_task(Arc::clone(&state.host))
            } else {
                Task::none()
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
            Task::none()
        }
    }
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
        text(format!(
            "assistant (draft): {}",
            snapshot_text(&draft.snapshot)
        ))
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
                text(format!("approval: {}", approval.request.call.name())),
                button("Allow").on_press(UiMessage::Approve(approval.request.id.clone())),
                button("Deny").on_press(UiMessage::Deny(approval.request.id.clone())),
            ]
            .spacing(8)
            .into()
        })
        .collect::<Vec<Element<'_, UiMessage>>>();

    let conversation = scrollable(column(messages).spacing(8)).height(Fill);
    let composer = row![
        text_input("Message", &state.input)
            .on_input(UiMessage::InputChanged)
            .on_submit(UiMessage::Submit)
            .width(Fill),
        button("Send").on_press(UiMessage::Submit),
        button("Stop").on_press(UiMessage::Stop),
    ]
    .spacing(8);

    container(
        column![
            text(format!("MoonTide · {:?}", state.render_state.run)),
            column(notices).spacing(4),
            conversation,
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
        MessageView::ToolCall { call, .. } => format!("tool call: {}", call.name()),
        MessageView::ToolResult { result, .. } => {
            format!("tool result: {} ({:?})", result.name(), result.status())
        }
    };
    text(label).into()
}

fn tool_view(tool: &ToolView) -> Element<'static, UiMessage> {
    text(tool_label(tool)).into()
}

fn tool_label(tool: &ToolView) -> String {
    let result = match &tool.result {
        Some(result) => format!("result={:?}: {:?}", result.status(), result.content()),
        None => "running".into(),
    };
    format!(
        "tool: {} ({}) input={:?}",
        tool.call.name(),
        result,
        tool.call.input()
    )
}

fn blocks_text(blocks: &[agent::ContentBlock]) -> String {
    blocks
        .iter()
        .map(|block| match block {
            agent::ContentBlock::Text { text } => text.clone(),
            agent::ContentBlock::Thinking { thinking } => format!("thinking: {thinking}"),
            agent::ContentBlock::ToolUse { name, .. } => format!("tool: {name}"),
            agent::ContentBlock::ToolResult { .. } => "tool result".into(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn snapshot_text(snapshot: &agent::ModelResponseSnapshot) -> String {
    blocks_text(&snapshot.content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::llm::protocol::ContentBlock;

    // 场景：RenderState 中的 assistant blocks 被最小 UI 文本视图读取。
    // 预期：文本、thinking 和 tool use 都保留可读摘要，并按原顺序连接。
    // 不变量：view helper 只读取 canonical payload，不修改 Session 或 RenderState。
    #[test]
    fn blocks_text_preserves_assistant_block_order() {
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

        assert_eq!(blocks_text(&blocks), "answer\nthinking: reason\ntool: grep");
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
    // 预期：工具名称、运行状态和输入都进入最小工具卡片文本。
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
        assert!(label.contains("hello"));
    }
}
