use std::fs::{
    self,
    File,
    OpenOptions,
};
use std::io::{
    BufRead,
    BufReader,
    Write,
};
use std::path::{
    Path,
    PathBuf,
};
use std::time::SystemTime;

use anyhow::{
    Context,
    Result,
};

use super::types::{
    SessionHeader,
    SessionItem,
};

pub(crate) struct FileSessionStore {
    session_id: String,
    meta_path: PathBuf,
    log_path: PathBuf,
}

impl FileSessionStore {
    pub(crate) fn create(sessions_dir: impl AsRef<Path>, header: &SessionHeader) -> Result<Self> {
        validate_session_id(&header.session_id)?;

        let sessions_dir = sessions_dir.as_ref();
        let storage_dir = sessions_dir.join(today_partition());
        fs::create_dir_all(&storage_dir)
            .with_context(|| format!("create session storage dir {}", storage_dir.display()))?;

        let store = Self::from_storage_dir(storage_dir, &header.session_id);
        store.write_header(header)?;
        File::create(&store.log_path)
            .with_context(|| format!("create log file {}", store.log_path.display()))?;

        Ok(store)
    }

    pub(crate) fn open(sessions_dir: impl AsRef<Path>, session_id: &str) -> Result<Self> {
        validate_session_id(session_id)?;

        let storage_dir = locate_session_dir(sessions_dir.as_ref(), session_id)?;
        let store = Self::from_storage_dir(storage_dir, session_id);

        if !store.meta_path.is_file() {
            anyhow::bail!("session meta not found: {}", store.meta_path.display());
        }
        if !store.log_path.is_file() {
            anyhow::bail!("session log not found: {}", store.log_path.display());
        }

        Ok(store)
    }

    pub(crate) fn read_header(&self) -> Result<SessionHeader> {
        let raw = fs::read_to_string(&self.meta_path)
            .with_context(|| format!("read session meta {}", self.meta_path.display()))?;
        let header: SessionHeader = serde_json::from_str(&raw)
            .with_context(|| format!("parse session meta {}", self.meta_path.display()))?;
        if header.session_id != self.session_id {
            anyhow::bail!(
                "session_id mismatch: meta={} path={}",
                header.session_id,
                self.session_id
            );
        }
        Ok(header)
    }

    pub(crate) fn read_items(&self, version: u32) -> Result<Vec<SessionItem>> {
        let file = File::open(&self.log_path)
            .with_context(|| format!("open session log {}", self.log_path.display()))?;
        let reader = BufReader::new(file);
        let mut items = Vec::new();

        for (line_no, line) in reader.lines().enumerate() {
            let line = line.with_context(|| {
                format!(
                    "read session log line {} in {}",
                    line_no + 1,
                    self.log_path.display()
                )
            })?;
            if line.trim().is_empty() {
                continue;
            }
            let mut value: serde_json::Value = serde_json::from_str(&line).with_context(|| {
                format!(
                    "parse session log line {} in {}",
                    line_no + 1,
                    self.log_path.display()
                )
            })?;
            migrate_v1_tool_result(version, &mut value);
            let item: SessionItem = serde_json::from_value(value).with_context(|| {
                format!(
                    "parse session log line {} in {}",
                    line_no + 1,
                    self.log_path.display()
                )
            })?;
            items.push(item);
        }

        Ok(items)
    }

    pub(crate) fn append_line(&self, line: &str) -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .with_context(|| format!("open session log for append {}", self.log_path.display()))?;
        file.write_all(line.as_bytes())
            .with_context(|| format!("write session log {}", self.log_path.display()))?;
        file.write_all(b"\n")
            .with_context(|| format!("write session log newline {}", self.log_path.display()))?;
        Ok(())
    }

    fn from_storage_dir(storage_dir: PathBuf, session_id: &str) -> Self {
        let (meta_path, log_path) = session_file_paths(&storage_dir, session_id);
        Self {
            session_id: session_id.to_string(),
            meta_path,
            log_path,
        }
    }

    fn write_header(&self, header: &SessionHeader) -> Result<()> {
        let raw = serde_json::to_string_pretty(header).context("serialize session header")?;
        fs::write(&self.meta_path, raw)
            .with_context(|| format!("write session meta {}", self.meta_path.display()))?;
        Ok(())
    }
}

fn migrate_v1_tool_result(version: u32, value: &mut serde_json::Value) {
    if version != 1 || value.get("kind").and_then(serde_json::Value::as_str) != Some("tool_outcome")
    {
        return;
    }

    if value.get("status").is_none() {
        value["status"] = serde_json::Value::String("outcome_unknown".to_owned());
    }

    if let Some(content) = value.get_mut("content") {
        let content_type = if content.is_string() { "text" } else { "json" };
        let legacy_content = content.take();
        *content = serde_json::json!({
            "type": content_type,
            "value": legacy_content,
        });
    }
}

pub(crate) fn locate_session_dir(sessions_dir: &Path, session_id: &str) -> Result<PathBuf> {
    validate_session_id(session_id)?;

    let entries = fs::read_dir(sessions_dir)
        .with_context(|| format!("read sessions dir {}", sessions_dir.display()))?;
    for entry in entries {
        let entry = entry
            .with_context(|| format!("read sessions dir entry in {}", sessions_dir.display()))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !is_date_partition(name) {
            continue;
        }
        if path.join(format!("{session_id}.meta.json")).is_file() {
            return Ok(path);
        }
    }

    anyhow::bail!(
        "session meta not found under {} for session_id {session_id}",
        sessions_dir.display()
    )
}

pub(crate) fn latest_session_id(sessions_dir: &Path) -> Result<Option<String>> {
    let entries = match fs::read_dir(sessions_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("read sessions dir {}", sessions_dir.display()));
        }
    };

    let mut latest: Option<(SystemTime, String)> = None;
    for entry in entries {
        let entry = entry
            .with_context(|| format!("read sessions dir entry in {}", sessions_dir.display()))?;
        let storage_dir = entry.path();
        if !storage_dir.is_dir() {
            continue;
        }
        let partition = entry.file_name();
        let Some(partition) = partition.to_str() else {
            continue;
        };
        if !is_date_partition(partition) {
            continue;
        }

        for file in fs::read_dir(&storage_dir)
            .with_context(|| format!("read session partition {}", storage_dir.display()))?
        {
            let file = file.with_context(|| {
                format!("read session partition entry in {}", storage_dir.display())
            })?;
            let path = file.path();
            let Some(name) = file.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Some(session_id) = name.strip_suffix(".meta.json") else {
                continue;
            };
            if validate_session_id(session_id).is_err() {
                continue;
            }

            let (_, log_path) = session_file_paths(&storage_dir, session_id);
            if !path.is_file() || !log_path.is_file() {
                continue;
            }
            let modified = newest_modified_time(&path, &log_path)?;
            let is_newer = match latest.as_ref() {
                None => true,
                Some((latest_time, latest_id)) => {
                    modified > *latest_time
                        || (modified == *latest_time && session_id > latest_id.as_str())
                }
            };
            if is_newer {
                latest = Some((modified, session_id.to_owned()));
            }
        }
    }

    Ok(latest.map(|(_, session_id)| session_id))
}

pub(crate) fn session_ids(sessions_dir: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(sessions_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("read sessions dir {}", sessions_dir.display()));
        }
    };

    let mut session_ids = Vec::new();
    for entry in entries {
        let entry = entry
            .with_context(|| format!("read sessions dir entry in {}", sessions_dir.display()))?;
        let storage_dir = entry.path();
        if !storage_dir.is_dir() {
            continue;
        }
        let partition = entry.file_name();
        let Some(partition) = partition.to_str() else {
            continue;
        };
        if !is_date_partition(partition) {
            continue;
        }

        for file in fs::read_dir(&storage_dir)
            .with_context(|| format!("read session partition {}", storage_dir.display()))?
        {
            let file = file.with_context(|| {
                format!("read session partition entry in {}", storage_dir.display())
            })?;
            let path = file.path();
            let Some(name) = file.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Some(session_id) = name.strip_suffix(".meta.json") else {
                continue;
            };
            if !path.is_file() || validate_session_id(session_id).is_err() {
                continue;
            }
            let (_, log_path) = session_file_paths(&storage_dir, session_id);
            if log_path.is_file() {
                session_ids.push(session_id.to_owned());
            }
        }
    }

    session_ids.sort();
    session_ids.dedup();
    Ok(session_ids)
}

fn newest_modified_time(meta_path: &Path, log_path: &Path) -> Result<SystemTime> {
    let meta_time = fs::metadata(meta_path)
        .with_context(|| format!("read session meta metadata {}", meta_path.display()))?
        .modified()
        .with_context(|| {
            format!(
                "read session meta modification time {}",
                meta_path.display()
            )
        })?;
    let log_time = match fs::metadata(log_path) {
        Ok(metadata) => Some(metadata.modified().with_context(|| {
            format!("read session log modification time {}", log_path.display())
        })?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(error)
                .with_context(|| format!("read session log metadata {}", log_path.display()));
        }
    };

    Ok(log_time.map_or(meta_time, |time| time.max(meta_time)))
}

fn session_file_paths(storage_dir: &Path, session_id: &str) -> (PathBuf, PathBuf) {
    (
        storage_dir.join(format!("{session_id}.meta.json")),
        storage_dir.join(format!("{session_id}.log.jsonl")),
    )
}

fn today_partition() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn is_date_partition(name: &str) -> bool {
    chrono::NaiveDate::parse_from_str(name, "%Y-%m-%d").is_ok()
}

pub(crate) fn validate_session_id(session_id: &str) -> Result<()> {
    session_id
        .parse::<uuid::Uuid>()
        .map_err(|_| anyhow::anyhow!("invalid session_id: {session_id}"))?;
    Ok(())
}

pub(crate) fn new_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn new_item_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}
