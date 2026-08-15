use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::file_store::{self, FileSessionStore};
use super::types::{
    freeze_item, validate_draft, SessionHeader, SessionItem, SessionItemBase, SessionItemDraft,
    SESSION_HEADER_VERSION,
};

pub struct SessionStore {
    header: SessionHeader,
    items: Vec<SessionItem>,
    next_seq: u64,
    store: FileSessionStore,
}

impl SessionStore {
    pub fn create(sessions_dir: impl AsRef<Path>, cwd: PathBuf) -> Result<Self> {
        let session_id = file_store::new_session_id();
        let header = SessionHeader {
            version: SESSION_HEADER_VERSION,
            session_id: session_id.clone(),
            cwd,
            parent_session: None,
            seed_len: 0,
        };

        let store = FileSessionStore::create(sessions_dir, &header)?;
        Ok(Self {
            header,
            items: Vec::new(),
            next_seq: 0,
            store,
        })
    }

    pub fn load(sessions_dir: impl AsRef<Path>, session_id: &str) -> Result<Self> {
        let store = FileSessionStore::open(sessions_dir, session_id)?;
        let header = store.read_header()?;
        let items = store.read_items()?;
        validate_loaded_items(&items)?;

        Ok(Self {
            next_seq: items.len() as u64,
            header,
            items,
            store,
        })
    }

    pub fn commit_item(&mut self, draft: SessionItemDraft) -> Result<&SessionItem> {
        validate_draft(&draft, &self.items)?;

        let base = SessionItemBase {
            id: file_store::new_item_id(),
            seq: self.next_seq,
            session_id: self.header.session_id.clone(),
            turn: draft.turn(),
            at: file_store::now_iso8601(),
        };

        let item = freeze_item(draft, base);
        let line = serde_json::to_string(&item).context("serialize session item")?;

        let idx = self.items.len();
        self.items.push(item);
        self.next_seq += 1;

        if let Err(err) = self.store.append_line(&line) {
            self.items.pop();
            self.next_seq -= 1;
            return Err(err);
        }

        self.items
            .get(idx)
            .ok_or_else(|| anyhow::anyhow!("committed item missing after push"))
    }

    pub fn items(&self) -> &[SessionItem] {
        &self.items
    }

    pub fn header(&self) -> &SessionHeader {
        &self.header
    }
}

fn validate_loaded_items(items: &[SessionItem]) -> Result<()> {
    for (expected_seq, item) in items.iter().enumerate() {
        let actual_seq = item.base().seq;
        if actual_seq != expected_seq as u64 {
            anyhow::bail!(
                "session log seq gap at line {}: expected {expected_seq}, got {actual_seq}",
                expected_seq + 1
            );
        }
    }
    Ok(())
}
