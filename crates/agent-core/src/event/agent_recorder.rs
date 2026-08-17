use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use anyhow::{Context, Result};
use serde_json::{json, Value};

use super::derive::{derive_agent_event, AgentEventRecord};
use super::file_writer::FileWriter;
use super::registry::HookHandler;
use super::trace_context::TraceContext;
use super::turn_event::TurnEvent;

/// Maximum serialized size of a persisted Agent Event JSONL line.
pub(crate) const MAX_AGENT_EVENT_BYTES: usize = 64 * 1024;

/// Receives a derived Agent Event record.
pub trait AgentEventRecorder: Send + Sync {
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}

/// Post-commit hook that derives Agent Event records and appends them.
pub struct DeriveAgentEventHook<W> {
    recorder: W,
}

impl<W> DeriveAgentEventHook<W>
where
    W: AgentEventRecorder,
{
    pub fn new(recorder: W) -> Self {
        Self { recorder }
    }
}

impl<W> HookHandler for DeriveAgentEventHook<W>
where
    W: AgentEventRecorder,
{
    fn on_event(&self, ctx: &TraceContext, event: &TurnEvent) -> anyhow::Result<()> {
        if let Some(record) = derive_agent_event(ctx, event)? {
            self.recorder.append(record)?;
        }
        Ok(())
    }
}

/// Appends Agent Event records using a file writer for physical I/O.
///
/// This type owns Agent Event semantics: identity validation, sequence and
/// turn recovery, bounded JSONL encoding, and append state. [`FileWriter`]
/// only performs path-based filesystem I/O.
pub struct FileAgentEventRecorder {
    file: FileWriter,
    run_id: String,
    state: Mutex<RecorderState>,
}

#[derive(Debug, Default)]
struct RecorderState {
    next_seq: u64,
    last_turn: Option<u64>,
}

impl FileAgentEventRecorder {
    pub fn new(runs_dir: impl AsRef<Path>, run_id: &str) -> Result<Self> {
        let path = runs_dir.as_ref().join(format!("{run_id}.active.jsonl"));
        let file = FileWriter::open(path)?;
        let state = read_existing_state(&file, run_id)?;
        Ok(Self {
            file,
            run_id: run_id.to_string(),
            state: Mutex::new(state),
        })
    }

    pub fn path(&self) -> &Path {
        self.file.path()
    }

    /// Returns the last persisted turn, if the active file already contains an event.
    pub fn last_turn(&self) -> Result<Option<u64>> {
        Ok(lock_state(&self.state)?.last_turn)
    }
}

impl AgentEventRecorder for FileAgentEventRecorder {
    fn append(&self, mut record: AgentEventRecord) -> Result<()> {
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
        self.file.append_line(&line)?;
        state.next_seq += 1;
        state.last_turn = Some(record.turn);
        Ok(())
    }
}

fn read_existing_state(file: &FileWriter, run_id: &str) -> Result<RecorderState> {
    let mut state = RecorderState::default();
    for (line_idx, line) in file.read_lines()?.into_iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record: AgentEventRecord = serde_json::from_str(&line).with_context(|| {
            format!(
                "parse existing agent event line {} in {}",
                line_idx + 1,
                file.path().display()
            )
        })?;
        if record.run_id != run_id {
            anyhow::bail!(
                "existing agent event line {} in {} has runId {}, expected {}",
                line_idx + 1,
                file.path().display(),
                record.run_id,
                run_id
            );
        }
        let seq = record.seq.with_context(|| {
            format!(
                "existing agent event line {} in {} has no seq",
                line_idx + 1,
                file.path().display()
            )
        })?;
        let candidate = seq
            .checked_add(1)
            .with_context(|| format!("agent event seq overflow in {}", file.path().display()))?;
        if candidate > state.next_seq {
            state.next_seq = candidate;
            state.last_turn = Some(record.turn);
        }
    }
    Ok(state)
}

fn lock_state(state: &Mutex<RecorderState>) -> Result<MutexGuard<'_, RecorderState>> {
    state
        .lock()
        .map_err(|_| anyhow::anyhow!("agent event seq lock poisoned"))
}

/// Applies the file format's 64 KiB line limit without changing identity fields.
pub(crate) fn truncate_record(mut record: AgentEventRecord) -> AgentEventRecord {
    let Ok(mut bytes) = serde_json::to_vec(&record) else {
        return record;
    };
    if fits_persisted_line(bytes.len()) {
        return record;
    }

    let original_bytes = bytes.len() as u64;
    record.truncated = Some(true);
    record.original_bytes = Some(original_bytes);
    truncate_value_strings(&mut record.payload, MAX_AGENT_EVENT_BYTES / 4);

    if let Ok(reencoded) = serde_json::to_vec(&record) {
        bytes = reencoded;
    }
    if !fits_persisted_line(bytes.len()) {
        record.payload = json!({ "truncated": true });
        if let Ok(replaced) = serde_json::to_vec(&record) {
            bytes = replaced;
        }
    }

    if !fits_persisted_line(bytes.len()) {
        record.preview = None;
    }

    record
}

fn fits_persisted_line(serialized_bytes: usize) -> bool {
    serialized_bytes.saturating_add(1) <= MAX_AGENT_EVENT_BYTES
}

fn truncate_value_strings(value: &mut Value, max_string_bytes: usize) {
    match value {
        Value::String(s) => {
            if s.len() > max_string_bytes {
                let mut end = max_string_bytes.min(s.len());
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                *s = format!("{}…", &s[..end]);
            }
        }
        Value::Array(items) => {
            for item in items {
                truncate_value_strings(item, max_string_bytes);
            }
        }
        Value::Object(map) => {
            for v in map.values_mut() {
                truncate_value_strings(v, max_string_bytes);
            }
        }
        _ => {}
    }
}
