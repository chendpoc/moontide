//! MoonTide's composition root for one persistent agent session.

mod agent;
mod bootstrap;
mod config;
mod log;
mod progress;
mod prompt;

pub mod platform;

pub use agent::Agent;
pub use agent_core::{
    event::{LlmCallFailureKind, LlmCallOutcome},
    llm::{
        adapter::AdapterFamily,
        protocol::{
            ContentBlock, ModelResponse, ModelResponseSnapshot, PendingBlock, StopReason,
            ThinkingLevel,
        },
    },
    r#loop::{ToolApproval, ToolApprovalHandler, ToolPermission, ToolPermissionMap},
    tools::{ToolCall, ToolResult},
};
pub use config::ProgressObserver;
pub use config::{
    AgentConfig, DiagnosticPersistence, PersistenceConfig, ProviderConfig, SessionPersistence,
};
pub use log::{AgentEventLogHandle, AgentEventLogState, AgentEventLogStatus};
pub use progress::{ProgressEvent, ProgressHandle, ProgressStatus, ProgressWorkerState};

/// Returns the most recently modified persisted session without creating a runtime Agent.
pub fn latest_session_id(
    sessions_dir: impl AsRef<std::path::Path>,
) -> anyhow::Result<Option<String>> {
    agent_core::session::SessionStore::latest_session_id(sessions_dir)
}

#[cfg(test)]
mod tests;
