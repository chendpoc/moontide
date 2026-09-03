use serde::{
    Deserialize,
    Serialize,
};
use serde_json::Value;

use super::request::{
    StopReason,
    Usage,
};

/// Single LLM call stream item emitted by adapter / normalize.
///
/// Loop must fold via [`crate::llm::ModelResponseBuilder`], not match this enum directly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ModelStreamEvent {
    TextPart {
        block_index: u32,
        text: String,
    },
    ThinkingPart {
        block_index: u32,
        thinking: String,
    },
    ToolUseStarted {
        id: String,
        name: String,
    },
    ToolUsePart {
        id: String,
        input_json: String,
    },
    ToolUseFinished {
        id: String,
        name: String,
        input: Value,
    },
    Finished {
        stop_reason: StopReason,
        usage: Option<Usage>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        response_id: Option<String>,
    },
}
