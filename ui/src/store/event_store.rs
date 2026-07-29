use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::model::{
    chat_row_from_event, context_card_from_event, trace_row_from_event, AgentEvent, ChatRow,
    ContextCard, TraceRow, EVENTS_FILE, MAX_EVENTS, OCULEAU_DIR,
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

    pub fn set_workdir(&mut self, workdir: PathBuf) -> Result<()> {
        self.workdir = workdir;
        self.events.clear();
        self.run_id = None;
        self.file_offset = 0;
        self.load_initial()
    }

    pub fn events_path(&self) -> PathBuf {
        self.workdir.join(OCULEAU_DIR).join(EVENTS_FILE)
    }

    pub fn load_initial(&mut self) -> Result<()> {
        self.events.clear();
        self.run_id = None;
        self.file_offset = 0;

        let path = self.events_path();
        if !path.exists() {
            return Ok(());
        }

        let file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let reader = BufReader::new(file);
        let mut parsed: Vec<AgentEvent> = Vec::new();

        for line in reader.lines() {
            let line = line?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<AgentEvent>(trimmed) {
                parsed.push(event);
            }
        }

        if let Some(latest) = parsed.last() {
            self.run_id = Some(latest.run_id.clone());
        }

        self.events = parsed
            .into_iter()
            .filter(|event| self.run_id.as_ref().is_some_and(|id| id == &event.run_id))
            .collect();

        self.trim_to_max();
        self.file_offset = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        Ok(())
    }

    pub fn reload_tail(&mut self) -> Result<bool> {
        let path = self.events_path();
        if !path.exists() {
            return Ok(false);
        }

        let mut file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let len = file.metadata()?.len();

        if len < self.file_offset {
            return self.load_initial().map(|_| true);
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
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<AgentEvent>(trimmed) else {
                continue;
            };
            changed |= self.ingest(event);
        }

        Ok(changed)
    }

    fn ingest(&mut self, event: AgentEvent) -> bool {
        match &self.run_id {
            None => {
                self.run_id = Some(event.run_id.clone());
                self.events.push(event);
                self.trim_to_max();
                true
            }
            Some(current) if current == &event.run_id => {
                self.events.push(event);
                self.trim_to_max();
                true
            }
            Some(_) => {
                self.run_id = Some(event.run_id.clone());
                self.events.clear();
                self.events.push(event);
                self.trim_to_max();
                true
            }
        }
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
