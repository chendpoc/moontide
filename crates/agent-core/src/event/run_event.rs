use serde::{Deserialize, Serialize};

use crate::{
    llm::protocol::{ContentBlock, ModelResponseSnapshot, StopReason, Usage},
    tools::{ToolCall, ToolResult},
};

/// Compaction mode carried on `CompactionApplied` (maps to session `CompactionKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunCompactionKind {
    Prune,
    TailWindow,
    Summary,
}

/// Run-level semantic event emitted by `loop`.
#[derive(Debug, Clone, PartialEq)]
pub enum RunEvent {
    RunStarted {
        run_id: String,
        session_id: String,
    },
    RunEnded {
        run_id: String,
    },
    TurnStarted {
        turn: u64,
    },
    TurnEnded {
        turn: u64,
    },

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

    LlmCallStarted {
        turn: u64,
        step: u32,
        llm_call_id: String,
    },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
    MessageUpdate {
        turn: u64,
        step: u32,
        llm_call_id: String,
        snapshot: ModelResponseSnapshot,
    },

    // R2+
    CompactionApplied {
        turn: u64,
        compaction_kind: RunCompactionKind,
        compaction_save_id: Option<String>,
        excluded_item_ids: Vec<String>,
        before_tokens: Option<u64>,
        after_tokens: Option<u64>,
    },
    CompactionRecommended {
        turn: u64,
    },
    ContextPreflightEnded {
        turn: u64,
    },
    ContextPostflightEnded {
        turn: u64,
    },
}

impl RunEvent {
    /// Whether this event triggers the commit phase of the dispatch pipeline.
    pub fn is_committable(&self) -> bool {
        matches!(
            self,
            RunEvent::UserPromptCommitted { .. }
                | RunEvent::AssistantFinalized { .. }
                | RunEvent::ToolCallRecorded { .. }
                | RunEvent::ToolResultRecorded { .. }
                | RunEvent::CompactionApplied { .. }
        )
    }
}
