use std::path::PathBuf;

use anyhow::Result;

use super::{file_store, SessionItem, SessionStore};

/// Stable read-only summary used by session pickers and host adapters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSummary {
    pub session_id: String,
    pub cwd: PathBuf,
    pub last_turn: Option<u64>,
    pub item_count: usize,
}

/// Parsed session view for read-only consumers.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionSnapshot {
    pub summary: SessionSummary,
    pub items: Vec<SessionItem>,
}

/// Read-only access to persisted Session Item Logs.
pub struct SessionQuery {
    sessions_dir: PathBuf,
}

impl SessionQuery {
    pub fn new(sessions_dir: impl Into<PathBuf>) -> Self {
        Self {
            sessions_dir: sessions_dir.into(),
        }
    }

    pub fn list(&self) -> Result<Vec<SessionSummary>> {
        let mut summaries = file_store::session_ids(&self.sessions_dir)?
            .into_iter()
            .map(|session_id| self.load(&session_id).map(|snapshot| snapshot.summary))
            .collect::<Result<Vec<_>>>()?;
        summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        Ok(summaries)
    }

    pub fn load(&self, session_id: &str) -> Result<SessionSnapshot> {
        let store = SessionStore::load(&self.sessions_dir, session_id)?;
        let summary = summary(store.header(), store.items());
        Ok(SessionSnapshot {
            summary,
            items: store.items().to_vec(),
        })
    }
}

fn summary(header: &super::SessionHeader, items: &[SessionItem]) -> SessionSummary {
    SessionSummary {
        session_id: header.session_id.clone(),
        cwd: header.cwd.clone(),
        last_turn: items.last().map(|item| item.base().turn),
        item_count: items.len(),
    }
}
