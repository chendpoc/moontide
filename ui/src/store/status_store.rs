use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::model::{StatusSnapshot, OCULA_DIR, STATUS_FILE};

pub struct StatusStore {
    workdir: PathBuf,
    snapshot: StatusSnapshot,
}

impl StatusStore {
    pub fn new(workdir: PathBuf) -> Self {
        Self {
            workdir,
            snapshot: StatusSnapshot::default(),
        }
    }

    pub fn set_workdir(&mut self, workdir: PathBuf) {
        self.workdir = workdir;
        self.snapshot = StatusSnapshot::default();
    }

    pub fn status_path(&self) -> PathBuf {
        self.workdir.join(OCULA_DIR).join(STATUS_FILE)
    }

    pub fn reload(&mut self) -> Result<bool> {
        let path = self.status_path();
        if !path.exists() {
            self.snapshot = StatusSnapshot::default();
            return Ok(false);
        }

        let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let parsed: StatusSnapshot = serde_json::from_str(&raw)?;
        let changed = parsed.phase != self.snapshot.phase
            || parsed.model != self.snapshot.model
            || parsed.run_id != self.snapshot.run_id
            || parsed.turn != self.snapshot.turn
            || parsed.context_pct != self.snapshot.context_pct;
        self.snapshot = parsed;
        Ok(changed)
    }

    pub fn snapshot(&self) -> &StatusSnapshot {
        &self.snapshot
    }

    pub fn workdir_display(&self, fallback: &Path) -> String {
        if !self.snapshot.workdir.is_empty() {
            return self.snapshot.workdir.clone();
        }
        fallback.display().to_string()
    }
}
