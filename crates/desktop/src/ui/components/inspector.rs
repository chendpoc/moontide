use iced::widget::{column, row, text};
use iced::{Element, Fill};

use super::super::{composer as state_composer, InspectorSelection, UiMessage, UiState};
use super::cards::thinking_text;
use super::controls::{danger_button, panel, secondary_button, text_button};
use crate::render_state::AssistantDraftKey;

pub fn inspector(state: &UiState) -> Element<'_, UiMessage> {
    let body = match state.inspector_selection.as_ref() {
        Some(InspectorSelection::Tool { tool_use_id }) => tool(state, tool_use_id),
        Some(InspectorSelection::Approval { approval_id }) => approval(state, approval_id),
        Some(InspectorSelection::Thinking { turn, llm_call_id }) => {
            thinking(state, *turn, llm_call_id)
        }
        None => text("Select a tool, approval, or thinking item.").into(),
    };

    panel(column![text("Inspector"), body].spacing(8))
        .width(iced::FillPortion(2))
        .height(Fill)
        .into()
}

fn tool(state: &UiState, tool_use_id: &str) -> Element<'static, UiMessage> {
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

fn approval(state: &UiState, approval_id: &str) -> Element<'static, UiMessage> {
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
            secondary_button("Allow").on_press_maybe(
                state_composer::allows_approval(state)
                    .then_some(UiMessage::Approve(approval.request.id.clone())),
            ),
            danger_button("Deny").on_press_maybe(
                state_composer::allows_approval(state)
                    .then_some(UiMessage::Deny(approval.request.id.clone())),
            ),
        ]
        .spacing(8),
    ]
    .spacing(6)
    .into()
}

fn thinking(state: &UiState, turn: u64, llm_call_id: &str) -> Element<'static, UiMessage> {
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
        text_button(if state.thinking_expanded {
            "Collapse thinking"
        } else {
            "Expand thinking"
        })
        .on_press(UiMessage::ToggleThinking),
    ]
    .spacing(6)
    .into()
}
