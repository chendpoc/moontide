use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::llm::protocol::{ContentBlock, ToolResultContent};

pub const SESSION_HEADER_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionItemBase {
    pub id: String,
    pub seq: u64,
    pub session_id: String,
    pub turn: u64,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionItem {
    UserMessage {
        #[serde(flatten)]
        base: SessionItemBase,
        text: String,
    },
    AssistantMessage {
        #[serde(flatten)]
        base: SessionItemBase,
        blocks: Vec<ContentBlock>,
    },
    ToolInvocation {
        #[serde(flatten)]
        base: SessionItemBase,
        tool_use_id: String,
        name: String,
        input: Value,
    },
    ToolOutcome {
        #[serde(flatten)]
        base: SessionItemBase,
        tool_use_id: String,
        content: ToolResultContent,
    },
}

impl SessionItem {
    pub fn base(&self) -> &SessionItemBase {
        match self {
            SessionItem::UserMessage { base, .. }
            | SessionItem::AssistantMessage { base, .. }
            | SessionItem::ToolInvocation { base, .. }
            | SessionItem::ToolOutcome { base, .. } => base,
        }
    }

    pub fn text(&self) -> Option<&str> {
        match self {
            SessionItem::UserMessage { text, .. } => Some(text),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionHeader {
    pub version: u32,
    pub session_id: String,
    pub cwd: PathBuf,
    pub parent_session: Option<String>,
    pub seed_len: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SessionItemDraft {
    UserMessage {
        turn: u64,
        text: String,
    },
    AssistantMessage {
        turn: u64,
        blocks: Vec<ContentBlock>,
    },
    ToolInvocation {
        turn: u64,
        tool_use_id: String,
        name: String,
        input: Value,
    },
    ToolOutcome {
        turn: u64,
        tool_use_id: String,
        content: ToolResultContent,
    },
}

impl SessionItemDraft {
    pub fn turn(&self) -> u64 {
        match self {
            SessionItemDraft::UserMessage { turn, .. }
            | SessionItemDraft::AssistantMessage { turn, .. }
            | SessionItemDraft::ToolInvocation { turn, .. }
            | SessionItemDraft::ToolOutcome { turn, .. } => *turn,
        }
    }
}

pub(crate) fn validate_assistant_blocks(blocks: &[ContentBlock]) -> anyhow::Result<()> {
    for block in blocks {
        match block {
            ContentBlock::Text { .. } | ContentBlock::Thinking { .. } => {}
            ContentBlock::ToolUse { .. } | ContentBlock::ToolResult { .. } => {
                anyhow::bail!("assistant message blocks must not contain tool blocks");
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_draft(
    draft: &SessionItemDraft,
    items: &[SessionItem],
) -> anyhow::Result<()> {
    if let Some(last) = items.last() {
        let last_turn = last.base().turn;
        let draft_turn = draft.turn();
        if draft_turn < last_turn {
            anyhow::bail!("turn cannot decrease: last={last_turn}, draft={draft_turn}");
        }
    }

    match draft {
        SessionItemDraft::UserMessage { text, .. } => {
            if text.is_empty() {
                anyhow::bail!("user message text must not be empty");
            }
        }
        SessionItemDraft::AssistantMessage { blocks, .. } => validate_assistant_blocks(blocks)?,
        SessionItemDraft::ToolInvocation {
            tool_use_id, name, ..
        } => {
            if tool_use_id.is_empty() {
                anyhow::bail!("tool_use_id must not be empty");
            }
            if name.is_empty() {
                anyhow::bail!("tool name must not be empty");
            }
        }
        SessionItemDraft::ToolOutcome { tool_use_id, .. } => {
            if tool_use_id.is_empty() {
                anyhow::bail!("tool_use_id must not be empty");
            }
        }
    }

    Ok(())
}

pub(crate) fn freeze_item(draft: SessionItemDraft, base: SessionItemBase) -> SessionItem {
    match draft {
        SessionItemDraft::UserMessage { text, .. } => SessionItem::UserMessage { base, text },
        SessionItemDraft::AssistantMessage { blocks, .. } => {
            SessionItem::AssistantMessage { base, blocks }
        }
        SessionItemDraft::ToolInvocation {
            tool_use_id,
            name,
            input,
            ..
        } => SessionItem::ToolInvocation {
            base,
            tool_use_id,
            name,
            input,
        },
        SessionItemDraft::ToolOutcome {
            tool_use_id,
            content,
            ..
        } => SessionItem::ToolOutcome {
            base,
            tool_use_id,
            content,
        },
    }
}
