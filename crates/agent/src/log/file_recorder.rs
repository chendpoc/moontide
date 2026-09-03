use std::path::{
    Path,
    PathBuf,
};
use std::sync::{
    Mutex,
    MutexGuard,
};

use agent_core::event::AgentEventRecord;
use anyhow::{
    Context,
    Result,
};
use serde_json::{
    Value,
    json,
};

pub(crate) const MAX_AGENT_EVENT_BYTES: usize = 64 * 1024;

pub(crate) struct FileAgentEventRecorder {
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
    pub(crate) fn new(runs_dir: impl AsRef<Path>, run_id: &str) -> Result<Self> {
        let path = runs_dir.as_ref().join(format!("{run_id}.active.jsonl"));
        let file = FileWriter::open(path)?;
        let state = read_existing_state(&file, run_id)?;
        Ok(Self {
            file,
            run_id: run_id.to_owned(),
            state: Mutex::new(state),
        })
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &Path {
        self.file.path()
    }
}

impl FileAgentEventRecorder {
    pub(crate) fn append(&mut self, mut record: AgentEventRecord) -> Result<()> {
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
        state.next_seq = state
            .next_seq
            .checked_add(1)
            .context("agent event sequence overflow")?;
        state.last_turn = Some(record.turn);
        Ok(())
    }

    pub(crate) fn flush(&mut self) -> Result<()> {
        self.file.flush()
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
            for value in map.values_mut() {
                truncate_value_strings(value, max_string_bytes);
            }
        }
        _ => {}
    }
}

struct FileWriter {
    path: PathBuf,
    file: std::io::BufWriter<std::fs::File>,
}

impl FileWriter {
    fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create file writer directory {}", parent.display()))?;
        }
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .with_context(|| format!("open file writer path {}", path.display()))?;
        Ok(Self {
            path: path.to_path_buf(),
            file: std::io::BufWriter::new(file),
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn read_lines(&self) -> Result<Vec<String>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let raw = std::fs::read_to_string(&self.path)
            .with_context(|| format!("read file writer path {}", self.path.display()))?;
        Ok(raw.lines().map(ToOwned::to_owned).collect())
    }

    fn append_line(&mut self, line: &str) -> Result<()> {
        use std::io::Write;

        if line
            .as_bytes()
            .iter()
            .any(|byte| matches!(byte, b'\n' | b'\r'))
        {
            anyhow::bail!("file writer line contains a newline");
        }
        writeln!(self.file, "{line}")
            .with_context(|| format!("append file writer path {}", self.path.display()))?;
        Ok(())
    }

    fn flush(&mut self) -> Result<()> {
        use std::io::Write;

        self.file
            .flush()
            .with_context(|| format!("flush file writer path {}", self.path.display()))
    }
}
