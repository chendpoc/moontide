use std::path::PathBuf;

use anyhow::{
    Result,
    bail,
};

use super::{
    SessionItem,
    SessionStore,
    file_store,
};

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

impl SessionSnapshot {
    pub fn turn_page(&self, before_turn: Option<u64>, limit: usize) -> Result<SessionTurnPage> {
        if limit == 0 {
            bail!("Session Turn page limit must be greater than zero");
        }
        Ok(turn_page(self, before_turn, limit))
    }
}

/// One backwards page of complete Turns from a persisted Session Item Log.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionTurnPage {
    pub summary: SessionSummary,
    pub items: Vec<SessionItem>,
    pub oldest_turn: Option<u64>,
    pub has_older: bool,
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
        let mut summaries = self.map_snapshots(|snapshot| snapshot.summary)?;
        summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        Ok(summaries)
    }

    pub fn map_snapshots<T>(&self, project: impl FnMut(SessionSnapshot) -> T) -> Result<Vec<T>> {
        self.map_with(|session_id| self.load(session_id), project)
    }

    pub fn load(&self, session_id: &str) -> Result<SessionSnapshot> {
        let store = SessionStore::load(&self.sessions_dir, session_id)?;
        let summary = summary(store.header(), store.items());
        Ok(SessionSnapshot {
            summary,
            items: store.items().to_vec(),
        })
    }

    pub fn load_turn_page(
        &self,
        session_id: &str,
        before_turn: Option<u64>,
        limit: usize,
    ) -> Result<SessionTurnPage> {
        self.load(session_id)?.turn_page(before_turn, limit)
    }

    fn map_with<T>(
        &self,
        mut load: impl FnMut(&str) -> Result<SessionSnapshot>,
        mut project: impl FnMut(SessionSnapshot) -> T,
    ) -> Result<Vec<T>> {
        file_store::session_ids(&self.sessions_dir)?
            .into_iter()
            .map(|session_id| load(&session_id).map(&mut project))
            .collect()
    }
}

fn turn_page(
    snapshot: &SessionSnapshot,
    before_turn: Option<u64>,
    limit: usize,
) -> SessionTurnPage {
    let mut selected_turns = Vec::with_capacity(limit.min(snapshot.items.len()));
    for item in snapshot.items.iter().rev() {
        let turn = item.base().turn;
        if before_turn.is_some_and(|before| turn >= before) || selected_turns.last() == Some(&turn)
        {
            continue;
        }
        selected_turns.push(turn);
        if selected_turns.len() == limit {
            break;
        }
    }
    let oldest_turn = selected_turns.last().copied();
    let items = oldest_turn.map_or_else(Vec::new, |oldest| {
        snapshot
            .items
            .iter()
            .filter(|item| {
                let turn = item.base().turn;
                turn >= oldest && before_turn.is_none_or(|before| turn < before)
            })
            .cloned()
            .collect()
    });
    let has_older = oldest_turn
        .is_some_and(|oldest| snapshot.items.iter().any(|item| item.base().turn < oldest));
    SessionTurnPage {
        summary: snapshot.summary.clone(),
        items,
        oldest_turn,
        has_older,
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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use tempfile::TempDir;

    use super::*;

    // 场景：single-pass consumer 枚举两个持久化 Session，并通过可计数 loader 读取。
    // 预期：每个 session_id 恰好调用一次 loader。
    // 不变量：catalog 等 consumer 不会退化为 list summary 后再次逐项读取。
    #[test]
    fn map_with_loads_and_projects_each_session_before_advancing() {
        let root = TempDir::new().expect("tempdir");
        let sessions_dir = root.path().join("sessions");
        let first = SessionStore::create(&sessions_dir, PathBuf::from("/first")).expect("first");
        let second = SessionStore::create(&sessions_dir, PathBuf::from("/second")).expect("second");
        let expected = [
            first.header().session_id.clone(),
            second.header().session_id.clone(),
        ];
        let query = SessionQuery::new(&sessions_dir);
        let mut calls = HashMap::<String, usize>::new();
        let order = RefCell::new(Vec::new());

        let loaded = query
            .map_with(
                |session_id| {
                    *calls.entry(session_id.to_owned()).or_default() += 1;
                    order.borrow_mut().push(format!("load:{session_id}"));
                    query.load(session_id)
                },
                |snapshot| {
                    order
                        .borrow_mut()
                        .push(format!("project:{}", snapshot.summary.session_id));
                    snapshot.summary.session_id
                },
            )
            .expect("list with loader");

        assert_eq!(loaded.len(), 2);
        for session_id in expected {
            assert_eq!(calls.get(&session_id), Some(&1));
        }
        for pair in order.borrow().as_chunks::<2>().0 {
            assert!(pair[0].starts_with("load:"));
            assert_eq!(
                pair[0].strip_prefix("load:"),
                pair[1].strip_prefix("project:")
            );
        }
    }
}
