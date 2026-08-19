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
    session::{SessionItem, SessionSnapshot, SessionSummary},
    tools::{ToolCall, ToolResult},
};
pub use config::ProgressObserver;
pub use config::{
    AgentConfig, DiagnosticPersistence, PersistenceConfig, ProviderConfig, SessionPersistence,
};
pub use log::{AgentEventLogHandle, AgentEventLogState, AgentEventLogStatus};
pub use progress::{ProgressEvent, ProgressHandle, ProgressStatus, ProgressWorkerState};

/// Read-only facade for persisted Session Item Logs.
pub struct SessionQuery {
    inner: agent_core::session::SessionQuery,
}

impl SessionQuery {
    pub fn new(sessions_dir: std::path::PathBuf) -> Self {
        Self {
            inner: agent_core::session::SessionQuery::new(sessions_dir),
        }
    }

    pub fn list(&self) -> anyhow::Result<Vec<SessionSummary>> {
        self.inner.list()
    }

    pub fn load(&self, session_id: &str) -> anyhow::Result<SessionSnapshot> {
        self.inner.load(session_id)
    }
}

/// Returns the most recently modified persisted session without creating a runtime Agent.
pub fn latest_session_id(
    sessions_dir: impl AsRef<std::path::Path>,
) -> anyhow::Result<Option<String>> {
    agent_core::session::SessionStore::latest_session_id(sessions_dir)
}

/// Returns the most recently modified persisted session without creating a runtime Agent.
pub fn latest_session_id(
    sessions_dir: impl AsRef<std::path::Path>,
) -> anyhow::Result<Option<String>> {
    agent_core::session::SessionStore::latest_session_id(sessions_dir)
}

#[cfg(test)]
mod tests;
