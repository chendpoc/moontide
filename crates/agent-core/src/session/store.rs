use std::path::{
    Path,
    PathBuf,
};

use anyhow::{
    Context,
    Result,
};

use super::file_store::{
    self,
    FileSessionStore,
};
use super::types::{
    freeze_item,
    rebase_item,
    validate_draft,
    SessionHeader,
    SessionItem,
    SessionItemBase,
    SessionItemDraft,
    SESSION_HEADER_VERSION,
};

pub struct SessionStore {
    header: SessionHeader,
    items: Vec<SessionItem>,
    next_seq: u64,
    store: FileSessionStore,
}

impl SessionStore {
    pub fn latest_session_id(sessions_dir: impl AsRef<Path>) -> Result<Option<String>> {
        file_store::latest_session_id(sessions_dir.as_ref())
    }

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
        validate_header_version(header.version)?;
        let items = store.read_items(header.version)?;
        validate_loaded_items(&items, &header.session_id)?;

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

    pub fn fork(&self, sessions_dir: impl AsRef<Path>, boundary_item_id: &str) -> Result<Self> {
        let boundary_idx = self
            .items
            .iter()
            .position(|item| item.base().id == boundary_item_id)
            .ok_or_else(|| anyhow::anyhow!("boundary item not found: {boundary_item_id}"))?;
        validate_fork_boundary(&self.items, boundary_idx)?;

        let session_id = file_store::new_session_id();
        let seed_len = (boundary_idx + 1) as u64;
        let header = SessionHeader {
            version: SESSION_HEADER_VERSION,
            session_id: session_id.clone(),
            cwd: self.header.cwd.clone(),
            parent_session: Some(self.header.session_id.clone()),
            seed_len,
        };

        let store = FileSessionStore::create(sessions_dir, &header)?;
        let mut forked_items = Vec::with_capacity(boundary_idx + 1);

        for (seq, source) in self.items[..=boundary_idx].iter().enumerate() {
            let base = SessionItemBase {
                id: source.base().id.clone(),
                seq: seq as u64,
                session_id: session_id.clone(),
                turn: source.base().turn,
                at: source.base().at.clone(),
            };
            let item = rebase_item(source, base);
            let line = serde_json::to_string(&item).context("serialize forked session item")?;
            store.append_line(&line)?;
            forked_items.push(item);
        }

        Ok(Self {
            header,
            items: forked_items,
            next_seq: seed_len,
            store,
        })
    }

    pub fn items(&self) -> &[SessionItem] {
        &self.items
    }

    pub fn header(&self) -> &SessionHeader {
        &self.header
    }

    pub(crate) fn next_turn(&self) -> Result<u64> {
        match self.items.last() {
            None => Ok(0),
            Some(item) => item
                .base()
                .turn
                .checked_add(1)
                .ok_or_else(|| anyhow::anyhow!("session turn number overflow")),
        }
    }
}

fn validate_fork_boundary(items: &[SessionItem], boundary_idx: usize) -> Result<()> {
    let boundary_turn = items[boundary_idx].base().turn;
    let has_later_same_turn = items[boundary_idx + 1..]
        .iter()
        .any(|item| item.base().turn == boundary_turn);
    if has_later_same_turn {
        anyhow::bail!("boundary item must be the last item of its turn");
    }
    Ok(())
}

fn validate_loaded_items(items: &[SessionItem], session_id: &str) -> Result<()> {
    for (expected_seq, item) in items.iter().enumerate() {
        let actual_seq = item.base().seq;
        if actual_seq != expected_seq as u64 {
            anyhow::bail!(
                "session log seq gap at line {}: expected {expected_seq}, got {actual_seq}",
                expected_seq + 1
            );
        }
        if item.base().session_id != session_id {
            anyhow::bail!(
                "session log session_id mismatch at line {}: expected {session_id}, got {}",
                expected_seq + 1,
                item.base().session_id
            );
        }
        if expected_seq > 0 && item.base().turn < items[expected_seq - 1].base().turn {
            anyhow::bail!(
                "session log turn decreased at line {}: previous {}, got {}",
                expected_seq + 1,
                items[expected_seq - 1].base().turn,
                item.base().turn,
            );
        }
        match item {
            SessionItem::ToolCall { call, .. }
                if call.tool_use_id().trim().is_empty() || call.name().trim().is_empty() =>
            {
                anyhow::bail!(
                    "invalid tool call identity at session log line {}",
                    expected_seq + 1
                );
            }
            SessionItem::ToolResult { result, .. }
                if result.tool_use_id().trim().is_empty() || result.name().trim().is_empty() =>
            {
                anyhow::bail!(
                    "invalid tool result identity at session log line {}",
                    expected_seq + 1
                );
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_header_version(version: u32) -> Result<()> {
    if !matches!(version, 1 | SESSION_HEADER_VERSION) {
        anyhow::bail!("unsupported session header version: {version}");
    }
    Ok(())
}
