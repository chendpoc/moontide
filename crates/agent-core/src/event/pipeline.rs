use std::sync::Arc;

use anyhow::Result;

use super::{CommitHandler, TurnEvent};

/// Commits `TurnEvent` facts through the injected Session adapter.
pub struct EventDispatcher {
    commit: Arc<dyn CommitHandler>,
}

impl EventDispatcher {
    pub fn new(commit: Arc<dyn CommitHandler>) -> Self {
        Self { commit }
    }

    pub fn emit(&self, event: TurnEvent) -> Result<()> {
        self.commit.commit(&event)
    }
}
