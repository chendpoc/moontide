use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use anyhow::{Context, Result};

use super::derive::{truncate_record, AgentEventRecord, AgentEventWriter, MAX_AGENT_EVENT_BYTES};

/// Appends derived Agent Event records to `{runs_dir}/{run_id}.active.jsonl`.
pub struct FileAgentEventWriter {
    path: PathBuf,
    run_id: String,
    state: Mutex<WriterState>,
}

#[derive(Debug, Default)]
struct WriterState {
    next_seq: u64,
    last_turn: Option<u64>,
}

impl FileAgentEventWriter {
    pub fn new(runs_dir: impl AsRef<Path>, run_id: &str) -> Result<Self> {
        let runs_dir = runs_dir.as_ref();
        std::fs::create_dir_all(runs_dir)
            .with_context(|| format!("create runs dir {}", runs_dir.display()))?;
        let path = runs_dir.join(format!("{run_id}.active.jsonl"));
        let state = read_existing_state(&path, run_id)?;
        Ok(Self {
            path,
            run_id: run_id.to_string(),
            state: Mutex::new(state),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns the last persisted turn, if the active file already contains an event.
    pub fn last_turn(&self) -> Result<Option<u64>> {
        Ok(lock_state(&self.state)?.last_turn)
    }
}

impl AgentEventWriter for FileAgentEventWriter {
    fn write(&self, mut record: AgentEventRecord) -> Result<()> {
        if record.run_id != self.run_id {
            anyhow::bail!(
                "agent event runId mismatch: expected {}, got {}",
                self.run_id,
                record.run_id
            );
        }
        let mut state = lock_state(&self.state)?;
        record.seq = Some(state.next_seq);
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
        state.next_seq += 1;
        state.last_turn = Some(record.turn);
        Ok(())
    }
}

fn read_existing_state(path: &Path, run_id: &str) -> Result<WriterState> {
    if !path.exists() {
        return Ok(WriterState::default());
    }

    let raw = fs::read_to_string(path)
        .with_context(|| format!("read existing agent event log {}", path.display()))?;
    let mut state = WriterState::default();
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
        if record.run_id != run_id {
            anyhow::bail!(
                "existing agent event line {} in {} has runId {}, expected {}",
                line_idx + 1,
                path.display(),
                record.run_id,
                run_id
            );
        }
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
        if candidate > state.next_seq {
            state.next_seq = candidate;
            state.last_turn = Some(record.turn);
        }
    }
    Ok(state)
}

fn lock_state(state: &Mutex<WriterState>) -> Result<MutexGuard<'_, WriterState>> {
    state
        .lock()
        .map_err(|_| anyhow::anyhow!("agent event seq lock poisoned"))
}
