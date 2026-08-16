use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ToolCall;

/// Provider-neutral content returned by a tool executor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolContent {
    Text(String),
    Json(Value),
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

/// Tool result attached to the provider-issued call identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

    pub fn succeeded(call: &ToolCall, content: ToolContent) -> Self {
        Self::with_status(call, ToolResultStatus::Succeeded, content)
    }

    pub fn failed(call: &ToolCall, content: ToolContent, retryable: bool) -> Self {
        Self::with_status(call, ToolResultStatus::Failed { retryable }, content)
    }

    pub fn outcome_unknown(call: &ToolCall, content: ToolContent) -> Self {
        Self::with_status(call, ToolResultStatus::OutcomeUnknown, content)
    }

    #[allow(
        dead_code,
        reason = "the loop implementation will construct non-executor results in a later review batch"
    )]
    pub(crate) fn with_status(
        call: &ToolCall,
        status: ToolResultStatus,
        content: ToolContent,
    ) -> Self {
        Self {
            tool_use_id: call.tool_use_id().to_owned(),
            name: call.name().to_owned(),
            status,
            content,
        }
    }
}
