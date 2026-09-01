//! Host-facing read-only Session Item Log query facade.
//!
//! Persisted log types and query implementation live in `agent_core::session`.
//! CLI / Desktop import this module only; they do not reach into `agent_core::session`
//! directly.

pub use agent_core::session::{SessionItem, SessionSnapshot, SessionSummary};

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
