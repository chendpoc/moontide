use std::sync::{Mutex, MutexGuard};

use anyhow::{anyhow, Result};

use crate::event::{CommitHandler, RunEvent};

use super::commit::commit_from_event;
use super::store::SessionStore;

/// Commit handler that persists committable events via `commit_from_event`.
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
    fn commit(&self, event: &RunEvent) -> Result<Option<String>> {
        let mut store = lock_store(&self.store)?;
        let item = commit_from_event(&mut store, event)?;
        Ok(Some(item.base().id.clone()))
    }
}

fn lock_store(store: &Mutex<SessionStore>) -> Result<MutexGuard<'_, SessionStore>> {
    store
        .lock()
        .map_err(|_| anyhow!("session store lock poisoned"))
}
