//! MoonTide LLM protocol types (domain layer, no IO).

mod delta;
mod error;
mod message;
mod request;

pub use delta::StreamDelta;
pub use error::{CancelReason, LlmError, RequestFailureKind};
pub use message::{
    ContentBlock, Message, MessageContent, Role, ToolResultContent, ToolSchema,
};
pub use request::{ModelRequest, ModelResponse, StopReason, ThinkingLevel, Usage};
