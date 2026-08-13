use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::model::{
    chat_row_from_event, context_card_from_event, trace_row_from_event, AgentEvent, ChatRow,
    ContextCard, TraceRow, ACTIVE_EVENTS_SUFFIX, MAX_EVENTS, MOONTIDE_DIR, RUNS_DIR,
};

pub struct EventStore {
    workdir: PathBuf,
    events: Vec<AgentEvent>,
    run_id: Option<String>,
    file_offset: u64,
}

impl EventStore {
    pub fn new(workdir: PathBuf) -> Self {
        Self {
            workdir,
            events: Vec::new(),
            run_id: None,
            file_offset: 0,
        }
    }

    pub fn workdir(&self) -> &Path {
        &self.workdir
    }

    pub fn set_workdir(&mut self, workdir: PathBuf) {
        self.workdir = workdir;
        self.events.clear();
        self.run_id = None;
        self.file_offset = 0;
    }

    pub fn set_run_id(&mut self, run_id: Option<String>) -> Result<bool> {
        if self.run_id == run_id {
            return Ok(false);
        }
        self.run_id = run_id;
        self.load_initial()?;
        Ok(true)
    }

    pub fn events_path(&self) -> Option<PathBuf> {
        let run_id = self.run_id.as_ref()?;
        Some(
            self.workdir
                .join(MOONTIDE_DIR)
                .join(RUNS_DIR)
                .join(format!("{run_id}{ACTIVE_EVENTS_SUFFIX}")),
        )
    }

    pub fn load_initial(&mut self) -> Result<()> {
        self.events.clear();
        self.file_offset = 0;
        self.read_active_from_start().map(|_| ())
    }

    pub fn reload_active_segment(&mut self) -> Result<bool> {
        self.file_offset = 0;
        self.read_active_from_start()
    }

    pub fn reload_tail(&mut self) -> Result<bool> {
        let Some(path) = self.events_path() else {
            return Ok(false);
        };
        if !path.exists() {
            return Ok(false);
        }

        let mut file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let len = file.metadata()?.len();

        if len < self.file_offset {
            return self.reload_active_segment();
        }

        if len == self.file_offset {
            return Ok(false);
        }

        file.seek(SeekFrom::Start(self.file_offset))?;
        let mut buffer = String::new();
        file.read_to_string(&mut buffer)?;
        self.file_offset = len;

        let mut changed = false;
        for line in buffer.lines() {
            changed |= self.ingest_line(line);
        }

        Ok(changed)
    }

    fn read_active_from_start(&mut self) -> Result<bool> {
        let Some(path) = self.events_path() else {
            return Ok(false);
        };
        if !path.exists() {
            return Ok(false);
        }

        let file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let reader = BufReader::new(file);
        let mut changed = false;
        for line in reader.lines() {
            changed |= self.ingest_line(&line?);
        }
        self.file_offset = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        Ok(changed)
    }

    fn ingest_line(&mut self, line: &str) -> bool {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return false;
        }
        let Ok(event) = serde_json::from_str::<AgentEvent>(trimmed) else {
            return false;
        };
        self.ingest(event)
    }

    fn ingest(&mut self, event: AgentEvent) -> bool {
        if self
            .run_id
            .as_ref()
            .is_none_or(|current| current != &event.run_id)
        {
            return false;
        }
        if self.events.iter().any(|existing| existing.id == event.id) {
            return false;
        }

        self.events.push(event);
        self.trim_to_max();
        true
    }

    fn trim_to_max(&mut self) {
        if self.events.len() > MAX_EVENTS {
            let drop_count = self.events.len() - MAX_EVENTS;
            self.events.drain(0..drop_count);
        }
    }

    pub fn trace_rows(&self) -> Vec<TraceRow> {
        self.events
            .iter()
            .filter_map(trace_row_from_event)
            .collect()
    }

    pub fn chat_rows(&self) -> Vec<ChatRow> {
        self.events
            .iter()
            .filter_map(chat_row_from_event)
            .collect()
    }

    pub fn context_cards(&self) -> Vec<ContextCard> {
        self.events
            .iter()
            .filter_map(context_card_from_event)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn temp_workdir() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "moontide-ui-event-store-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(path.join(MOONTIDE_DIR).join(RUNS_DIR)).expect("create temp runs");
        path
    }

    fn event_line(id: &str, run_id: &str, seq: u64) -> String {
        format!(
            "{{\"id\":\"{id}\",\"seq\":{seq},\"runId\":\"{run_id}\",\"turn\":1,\"phase\":\"post_llm\",\"channel\":\"trace\",\"kind\":\"thinking\",\"ts\":1,\"payload\":{{\"body\":\"{id}\"}}}}\n"
        )
    }

    #[test]
    fn keeps_loaded_events_when_active_segment_rotates() {
        let workdir = temp_workdir();
        let runs = workdir.join(MOONTIDE_DIR).join(RUNS_DIR);
        let active = runs.join("run-1.active.jsonl");
        fs::write(&active, event_line("event-1", "run-1", 1)).expect("write first");

        let mut store = EventStore::new(workdir.clone());
        store
            .set_run_id(Some("run-1".to_string()))
            .expect("load first");
        assert_eq!(store.events.len(), 1);

        fs::remove_file(&active).expect("remove rotated active");
        assert!(!store.reload_active_segment().expect("missing active"));
        assert_eq!(store.events.len(), 1);

        fs::write(&active, event_line("event-2", "run-1", 2)).expect("write second");
        assert!(store.reload_active_segment().expect("load replacement"));
        assert_eq!(store.events.len(), 2);

        fs::remove_dir_all(workdir).ok();
    }

    #[test]
    fn switches_run_and_ignores_previous_active_file() {
        let workdir = temp_workdir();
        let runs = workdir.join(MOONTIDE_DIR).join(RUNS_DIR);
        fs::write(
            runs.join("run-1.active.jsonl"),
            event_line("event-1", "run-1", 1),
        )
        .expect("write first run");
        fs::write(
            runs.join("run-2.active.jsonl"),
            event_line("event-2", "run-2", 1),
        )
        .expect("write second run");

        let mut store = EventStore::new(workdir.clone());
        store
            .set_run_id(Some("run-1".to_string()))
            .expect("load first run");
        assert_eq!(store.events[0].run_id, "run-1");

        store
            .set_run_id(Some("run-2".to_string()))
            .expect("load second run");
        assert_eq!(store.events.len(), 1);
        assert_eq!(store.events[0].run_id, "run-2");

        fs::remove_dir_all(workdir).ok();
    }
}
