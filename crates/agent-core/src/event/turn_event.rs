use serde::{
    Deserialize,
    Serialize,
};

use crate::llm::protocol::{
    CancelReason,
    ContentBlock,
    ModelResponseSnapshot,
    RequestFailureKind,
    StopReason,
    Usage,
};
use crate::tools::{
    ToolCall,
    ToolResult,
};

/// Compaction mode carried on `CompactionApplied` (maps to session `CompactionKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnCompactionKind {
    Prune,
    TailWindow,
    Summary,
}

/// Failure classification for one model-call attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmCallFailureKind {
    Request(RequestFailureKind),
    InvalidResponse,
}

/// Typed terminal outcome for one model-call attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LlmCallOutcome {
    Succeeded {
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
    Failed {
        kind: LlmCallFailureKind,
    },
    Cancelled {
        reason: CancelReason,
    },
}

/// Turn-level semantic event emitted by `loop`.
#[derive(Debug, Clone, PartialEq)]
pub enum TurnEvent {
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
        llm_call_id: String,
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
        outcome: LlmCallOutcome,
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
        compaction_kind: TurnCompactionKind,
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

impl TurnEvent {
    /// Whether this event triggers the commit phase of the dispatch pipeline.
    pub fn is_committable(&self) -> bool {
        matches!(
            self,
            TurnEvent::UserPromptCommitted { .. }
                | TurnEvent::AssistantFinalized { .. }
                | TurnEvent::ToolCallRecorded { .. }
                | TurnEvent::ToolResultRecorded { .. }
                | TurnEvent::CompactionApplied { .. }
        )
    }
}
