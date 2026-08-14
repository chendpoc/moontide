use serde::{Deserialize, Serialize};

use super::request::{StopReason, Usage};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamDelta {
    TextDelta {
        text: String,
    },
    ThinkingDelta {
        thinking: String,
    },
    ToolUseStart {
        id: String,
        name: String,
    },
    ToolUseDelta {
        id: String,
        input_json_delta: String,
    },
    ToolUseEnd {
        id: String,
    },
    MessageEnd {
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
}
