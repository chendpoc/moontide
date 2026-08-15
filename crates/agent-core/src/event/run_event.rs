use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::llm::protocol::{
    ContentBlock, ModelResponseSnapshot, StopReason, ToolResultContent, Usage,
};

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
    ToolInvocationRecorded {
        turn: u64,
        tool_use_id: String,
        name: String,
        input: Value,
    },
    ToolOutcomeRecorded {
        turn: u64,
        tool_use_id: String,
        content: ToolResultContent,
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
}

impl RunEvent {
    /// Whether this event triggers the commit phase of the dispatch pipeline.
    pub fn is_committable(&self) -> bool {
        matches!(
            self,
            RunEvent::UserPromptCommitted { .. }
                | RunEvent::AssistantFinalized { .. }
                | RunEvent::ToolInvocationRecorded { .. }
                | RunEvent::ToolOutcomeRecorded { .. }
        )
    }
}
