//! MoonTide LLM protocol types (domain layer, no IO).

mod error;
mod message;
mod request;
mod snapshot;
mod stream_event;

pub use error::{
    CancelReason,
    LlmError,
    RequestFailureKind,
};
pub use message::{
    ContentBlock,
    Message,
    MessageContent,
    Role,
    ToolResultContent,
    ToolSchema,
};
pub use request::{
    ModelRequest,
    ModelResponse,
    StopReason,
    ThinkingLevel,
    Usage,
};
pub use snapshot::{
    ModelResponseSnapshot,
    PendingBlock,
};
pub use stream_event::ModelStreamEvent;
