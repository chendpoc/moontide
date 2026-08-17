use std::sync::{Mutex, MutexGuard};

use anyhow::{anyhow, Result};

use crate::event::{CommitHandler, TurnEvent};

use super::commit::commit_from_event;
use super::store::SessionStore;

/// Commit handler that persists turn facts via `commit_from_event`.
pub struct SessionCommitHandler {
    store: Mutex<SessionStore>,
}

impl SessionCommitHandler {
    pub fn new(store: SessionStore) -> Self {
        Self {
            store: Mutex::new(store),
        }
    }
}

impl CommitHandler for SessionCommitHandler {
    fn commit(&self, event: &TurnEvent) -> Result<()> {
        let mut store = lock_store(&self.store)?;
        commit_from_event(&mut store, event)?;
        Ok(())
    }
}

fn lock_store(store: &Mutex<SessionStore>) -> Result<MutexGuard<'_, SessionStore>> {
    store
        .lock()
        .map_err(|_| anyhow!("session store lock poisoned"))
}
