use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use anyhow::{Context, Result};

use super::derive::{AgentEventRecord, AgentEventWriter};

/// Appends derived Agent Event records to `{runs_dir}/{run_id}.active.jsonl`.
pub struct FileAgentEventWriter {
    path: PathBuf,
    next_seq: Mutex<u64>,
}

impl FileAgentEventWriter {
    pub fn new(runs_dir: impl AsRef<Path>, run_id: &str) -> Result<Self> {
        let runs_dir = runs_dir.as_ref();
        std::fs::create_dir_all(runs_dir)
            .with_context(|| format!("create runs dir {}", runs_dir.display()))?;
        let path = runs_dir.join(format!("{run_id}.active.jsonl"));
        Ok(Self {
            path,
            next_seq: Mutex::new(0),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl AgentEventWriter for FileAgentEventWriter {
    fn write(&self, mut record: AgentEventRecord) -> Result<()> {
        let mut seq = lock_seq(&self.next_seq)?;
        record.seq = Some(*seq);
        *seq += 1;

        let line = serde_json::to_string(&record).context("serialize agent event")?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .with_context(|| format!("open agent event log {}", self.path.display()))?;
        file.write_all(line.as_bytes())
            .with_context(|| format!("write agent event log {}", self.path.display()))?;
        file.write_all(b"\n")
            .with_context(|| format!("write newline to {}", self.path.display()))?;
        Ok(())
    }
}

fn lock_seq(seq: &Mutex<u64>) -> Result<MutexGuard<'_, u64>> {
    seq.lock()
        .map_err(|_| anyhow::anyhow!("agent event seq lock poisoned"))
}
