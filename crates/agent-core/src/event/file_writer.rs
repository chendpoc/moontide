use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use anyhow::{Context, Result};

use super::derive::{truncate_record, AgentEventRecord, AgentEventWriter, MAX_AGENT_EVENT_BYTES};

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
        let next_seq = next_seq_from_file(&path)?;
        Ok(Self {
            path,
            next_seq: Mutex::new(next_seq),
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
        let record = truncate_record(record);

        let line = serde_json::to_string(&record).context("serialize agent event")?;
        if line.len().saturating_add(1) > MAX_AGENT_EVENT_BYTES {
            anyhow::bail!(
                "agent event exceeds {} bytes after truncation",
                MAX_AGENT_EVENT_BYTES
            );
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .with_context(|| format!("open agent event log {}", self.path.display()))?;
        file.write_all(line.as_bytes())
            .with_context(|| format!("write agent event log {}", self.path.display()))?;
        file.write_all(b"\n")
            .with_context(|| format!("write newline to {}", self.path.display()))?;
        *seq = seq.saturating_add(1);
        Ok(())
    }
}

fn next_seq_from_file(path: &Path) -> Result<u64> {
    if !path.exists() {
        return Ok(0);
    }

    let raw = fs::read_to_string(path)
        .with_context(|| format!("read existing agent event log {}", path.display()))?;
    let mut next_seq = 0;
    for (line_idx, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record: AgentEventRecord = serde_json::from_str(line).with_context(|| {
            format!(
                "parse existing agent event line {} in {}",
                line_idx + 1,
                path.display()
            )
        })?;
        let seq = record.seq.with_context(|| {
            format!(
                "existing agent event line {} in {} has no seq",
                line_idx + 1,
                path.display()
            )
        })?;
        let candidate = seq
            .checked_add(1)
            .with_context(|| format!("agent event seq overflow in {}", path.display()))?;
        next_seq = next_seq.max(candidate);
    }
    Ok(next_seq)
}

fn lock_seq(seq: &Mutex<u64>) -> Result<MutexGuard<'_, u64>> {
    seq.lock()
        .map_err(|_| anyhow::anyhow!("agent event seq lock poisoned"))
}
