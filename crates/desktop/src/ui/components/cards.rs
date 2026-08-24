use std::collections::BTreeSet;

use iced::widget::{column, row, scrollable, text};
use iced::{Element, Fill, FillPortion};

use super::super::{composer as state_composer, UiMessage, UiState};
use super::controls::{card, danger_button, secondary_button, text_button};
use crate::render_state::{MessageView, ToolView};

pub fn notice_list(state: &UiState) -> Element<'static, UiMessage> {
    let notices = state
        .render_state
        .notices
        .iter()
        .map(|notice| card(text(format!("{:?}: {}", notice.kind, notice.message))).into())
        .collect::<Vec<Element<'static, UiMessage>>>();

    column(notices).spacing(4).into()
}

pub fn conversation(state: &UiState) -> Element<'static, UiMessage> {
    let mut messages = state
        .render_state
        .messages
        .iter()
        .map(message)
        .collect::<Vec<_>>();

    messages.extend(state.render_state.assistant_drafts.values().map(|draft| {
        card(
            row![
                text(format!(
                    "assistant (draft): {}",
                    snapshot_text(&draft.snapshot)
                )),
                text_button("Thinking").on_press(UiMessage::SelectThinking {
                    turn: draft.key.turn,
                    llm_call_id: draft.key.llm_call_id.clone(),
                }),
            ]
            .spacing(8),
        )
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
        .collect::<BTreeSet<_>>();
    messages.extend(
        state
            .render_state
            .tools
            .values()
            .filter(|tool| !historical_tool_ids.contains(tool.call.tool_use_id()))
            .map(tool),
    );

    scrollable(column(messages).spacing(8))
        .width(FillPortion(3))
        .height(Fill)
        .into()
}

pub fn approval_list(state: &UiState) -> Element<'static, UiMessage> {
    let approvals = state
        .render_state
        .approvals
        .values()
        .map(|approval| {
            let approval_id = approval.request.id.clone();
            card(
                row![
                    text_button(text(format!("approval: {}", approval.request.call.name())))
                        .on_press(UiMessage::SelectApproval(approval_id.clone())),
                    secondary_button("Allow").on_press_maybe(
                        state_composer::allows_approval(state)
                            .then_some(UiMessage::Approve(approval_id.clone())),
                    ),
                    danger_button("Deny").on_press_maybe(
                        state_composer::allows_approval(state)
                            .then_some(UiMessage::Deny(approval_id)),
                    ),
                ]
                .spacing(8),
            )
            .into()
        })
        .collect::<Vec<Element<'static, UiMessage>>>();

    column(approvals).spacing(8).into()
}

fn message(message: &MessageView) -> Element<'static, UiMessage> {
    match message {
        MessageView::User {
            text: message_text, ..
        } => card(text(format!("user: {message_text}"))).into(),
        MessageView::Assistant { blocks, .. } => {
            card(text(format!("assistant: {}", blocks_text(blocks)))).into()
        }
        MessageView::ToolCall { call, .. } => {
            text_button(text(format!("tool call: {}", call.name())))
                .on_press(UiMessage::SelectTool(call.tool_use_id().to_owned()))
                .into()
        }
        MessageView::ToolResult { result, .. } => text_button(text(format!(
            "tool result: {} ({:?})",
            result.name(),
            result.status()
        )))
        .on_press(UiMessage::SelectTool(result.tool_use_id().to_owned()))
        .into(),
    }
}

fn tool(tool: &ToolView) -> Element<'static, UiMessage> {
    text_button(text(tool_label(tool)))
        .on_press(UiMessage::SelectTool(tool.call.tool_use_id().to_owned()))
        .into()
}

pub fn tool_label(tool: &ToolView) -> String {
    let result = match &tool.result {
        Some(result) => format!("{:?}", result.status()),
        None => "running".into(),
    };
    format!("tool: {} ({result})", tool.call.name())
}

pub fn blocks_text(blocks: &[agent::ContentBlock]) -> String {
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

pub fn snapshot_text(snapshot: &agent::ModelResponseSnapshot) -> String {
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

pub fn thinking_text(snapshot: &agent::ModelResponseSnapshot) -> String {
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
