use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ToolCall;

/// Provider-neutral content returned by a tool executor.
#[derive(Debug, Clone, PartialEq)]
pub enum ToolContent {
    Text(String),
    Json(Value),
}

/// Executor-level outcome before it is attached to a concrete tool call.
#[derive(Debug, Clone, PartialEq)]
pub enum ToolOutput {
    Succeeded(ToolContent),
    Failed {
        content: ToolContent,
        retryable: bool,
    },
    OutcomeUnknown(ToolContent),
}

/// Stable cancellation reasons recorded in session and agent event logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCancellationReason {
    User,
    Parent,
    Hook,
    Disposed,
}

/// Normalized status for every attempted tool call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolResultStatus {
    Succeeded,
    Failed { retryable: bool },
    InvalidArguments,
    UnknownTool,
    Denied,
    Cancelled { reason: ToolCancellationReason },
    OutcomeUnknown,
}

/// Tool outcome attached to the provider-issued call identity.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolResult {
    tool_use_id: String,
    name: String,
    status: ToolResultStatus,
    content: ToolContent,
}

impl ToolResult {
    pub fn tool_use_id(&self) -> &str {
        &self.tool_use_id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn status(&self) -> &ToolResultStatus {
        &self.status
    }

    pub fn content(&self) -> &ToolContent {
        &self.content
    }

    #[allow(
        dead_code,
        reason = "the loop implementation will construct non-executor outcomes in a later review batch"
    )]
    pub(crate) fn new(call: &ToolCall, status: ToolResultStatus, content: ToolContent) -> Self {
        Self {
            tool_use_id: call.tool_use_id().to_owned(),
            name: call.name().to_owned(),
            status,
            content,
        }
    }

    #[allow(
        dead_code,
        reason = "Tool::execute is intentionally crate-internal until loop integration"
    )]
    pub(crate) fn from_output(call: &ToolCall, output: ToolOutput) -> Self {
        let (status, content) = match output {
            ToolOutput::Succeeded(content) => (ToolResultStatus::Succeeded, content),
            ToolOutput::Failed { content, retryable } => {
                (ToolResultStatus::Failed { retryable }, content)
            }
            ToolOutput::OutcomeUnknown(content) => (ToolResultStatus::OutcomeUnknown, content),
        };

        Self::new(call, status, content)
    }
}
