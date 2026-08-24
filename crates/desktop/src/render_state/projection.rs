use std::collections::BTreeMap;

use crate::DesktopError;

use super::model::{MessageView, NoticeKind, NoticeView, ToolView};

pub(super) fn error_notice(error: DesktopError) -> NoticeView {
    NoticeView {
        kind: NoticeKind::Error,
        message: error.message,
        recoverable: error.recoverable,
        error_kind: Some(error.kind),
    }
}

pub(super) fn project_session(
    snapshot: &agent::SessionSnapshot,
) -> (Vec<MessageView>, BTreeMap<String, ToolView>) {
    let mut messages = Vec::new();
    let mut tools = BTreeMap::new();

    for item in &snapshot.items {
        let turn = item.base().turn;
        match item {
            agent::SessionItem::UserMessage { text, .. } => {
                messages.push(MessageView::User {
                    turn,
                    text: text.clone(),
                });
            }
            agent::SessionItem::AssistantMessage { blocks, .. } => {
                messages.push(MessageView::Assistant {
                    turn,
                    blocks: blocks.clone(),
                });
            }
            agent::SessionItem::ToolCall { call, .. } => {
                tools.insert(
                    call.tool_use_id().to_owned(),
                    ToolView {
                        turn,
                        call: call.clone(),
                        result: None,
                    },
                );
                messages.push(MessageView::ToolCall {
                    turn,
                    call: call.clone(),
                });
            }
            agent::SessionItem::ToolResult { result, .. } => {
                if let Some(tool) = tools.get_mut(result.tool_use_id()) {
                    tool.result = Some(result.clone());
                }
                messages.push(MessageView::ToolResult {
                    turn,
                    result: result.clone(),
                });
            }
            agent::SessionItem::Compaction { .. }
            | agent::SessionItem::CheckpointCreated { .. } => {}
        }
    }

    (messages, tools)
}
