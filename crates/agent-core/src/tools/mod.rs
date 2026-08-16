//! Tool declarations, runtime bindings, registration, and one-call execution.

mod call;
mod executor;
mod registry;
mod result;
mod spec;
mod validate;

pub use call::ToolCall;
pub use executor::ToolExecutor;
pub use registry::{Tool, ToolRegistry};
pub use result::{ToolCancellationReason, ToolContent, ToolResult, ToolResultStatus};
pub use spec::ToolSpec;

#[cfg(test)]
mod tests;
