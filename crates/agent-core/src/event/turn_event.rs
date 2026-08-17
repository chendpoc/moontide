use serde::{Deserialize, Serialize};

use crate::{
    llm::protocol::ContentBlock,
    tools::{ToolCall, ToolResult},
};

/// Compaction mode carried on `CompactionApplied` (maps to session `CompactionKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnCompactionKind {
    Prune,
    TailWindow,
    Summary,
}

/// Turn fact emitted by `loop` for synchronous Session Item Log commit.
#[derive(Debug, Clone, PartialEq)]
pub enum TurnEvent {
    UserPromptCommitted {
        turn: u64,
        text: String,
    },
    AssistantFinalized {
        turn: u64,
        blocks: Vec<ContentBlock>,
    },
    ToolCallRecorded {
        turn: u64,
        call: ToolCall,
    },
    ToolResultRecorded {
        turn: u64,
        result: ToolResult,
    },

    // R2+
    CompactionApplied {
        turn: u64,
        compaction_kind: TurnCompactionKind,
        compaction_save_id: Option<String>,
        excluded_item_ids: Vec<String>,
        before_tokens: Option<u64>,
        after_tokens: Option<u64>,
    },
}

impl TurnEvent {
    pub fn turn(&self) -> u64 {
        match self {
            TurnEvent::UserPromptCommitted { turn, .. }
            | TurnEvent::AssistantFinalized { turn, .. }
            | TurnEvent::ToolCallRecorded { turn, .. }
            | TurnEvent::ToolResultRecorded { turn, .. }
            | TurnEvent::CompactionApplied { turn, .. } => *turn,
        }
    }
}
