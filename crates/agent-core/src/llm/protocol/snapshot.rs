use serde::{Deserialize, Serialize};

use super::message::ContentBlock;
use super::request::{StopReason, Usage};

/// In-progress block for streaming UI (not written to session log).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input_json: String,
    },
}

/// Renderable snapshot at a point in time during an LLM call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelResponseSnapshot {
    pub content: Vec<ContentBlock>,
    pub pending: Option<PendingBlock>,
    pub stop_reason: Option<StopReason>,
    pub usage: Option<Usage>,
    pub model: Option<String>,
}
