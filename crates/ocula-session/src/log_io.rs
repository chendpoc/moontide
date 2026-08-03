use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Utc;
use ocula_protocol::{SessionLog, SessionLogBase, SessionLogBody};
use serde_json::Value;

use crate::ids::new_event_id;
use crate::paths::session_log_path;

pub fn build_session_log(session_id: &str, turn: u32, body: SessionLogBody) -> SessionLog {
    let base = SessionLogBase {
        id: new_event_id(),
        session_id: session_id.to_string(),
        turn,
        at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    };

    match body {
        SessionLogBody::UserMessage { text } => SessionLog::UserMessage { base, text },
        SessionLogBody::AssistantMessage { blocks } => SessionLog::AssistantMessage { base, blocks },
        SessionLogBody::ToolInvocation {
            tool_use_id,
            name,
            input,
        } => SessionLog::ToolInvocation {
            base,
            tool_use_id,
            name,
            input,
        },
        SessionLogBody::ToolOutcome {
            tool_use_id,
            result_summary,
        } => SessionLog::ToolOutcome {
            base,
            tool_use_id,
            artifact_id: None,
            result_summary,
        },
    }
}

fn ensure_dir_for_file(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create dir {}", parent.display()))?;
    }
    Ok(())
}

pub fn append_log_line(path: &Path, record: &SessionLog) -> Result<()> {
    ensure_dir_for_file(path)?;
    let line = serde_json::to_string(record)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("open log {}", path.display()))?;
    writeln!(file, "{line}")?;
    Ok(())
}

pub fn read_log_lines(path: &Path) -> Result<Vec<String>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = fs::File::open(path).with_context(|| format!("open log {}", path.display()))?;
    let reader = BufReader::new(file);
    Ok(reader
        .lines()
        .filter_map(|line| line.ok())
        .filter(|line| !line.is_empty())
        .collect())
}

pub fn parse_log(lines: &[String]) -> Result<Vec<SessionLog>> {
    let mut log = Vec::new();
    for line in lines {
        let value: Value = serde_json::from_str(line)?;
        if ocula_protocol::is_session_log(&value) {
            log.push(serde_json::from_value(value)?);
        }
    }
    Ok(log)
}

pub struct FileSessionLogWriter {
    workdir: PathBuf,
}

impl FileSessionLogWriter {
    pub fn new(workdir: impl Into<PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
        }
    }

    pub fn append(&self, session_id: &str, record: &SessionLog) -> Result<()> {
        let path = session_log_path(&self.workdir, session_id);
        append_log_line(&path, record)
    }
}

pub struct FileSessionLogReader {
    workdir: PathBuf,
}

impl FileSessionLogReader {
    pub fn new(workdir: impl Into<PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
        }
    }

    pub fn read_all(&self, session_id: &str) -> Result<Vec<SessionLog>> {
        let path = session_log_path(&self.workdir, session_id);
        parse_log(&read_log_lines(&path)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ocula_protocol::ToolResultSummary;
    use tempfile::tempdir;

    #[test]
    fn round_trip_user_and_assistant() -> Result<()> {
        let dir = tempdir()?;
        let writer = FileSessionLogWriter::new(dir.path());
        let reader = FileSessionLogReader::new(dir.path());
        let session_id = "sess-test";

        let user = build_session_log(
            session_id,
            1,
            SessionLogBody::UserMessage {
                text: "hello".into(),
            },
        );
        writer.append(session_id, &user)?;

        let assistant = build_session_log(
            session_id,
            1,
            SessionLogBody::AssistantMessage {
                blocks: vec![ocula_protocol::ContentBlock::text("hi")],
            },
        );
        writer.append(session_id, &assistant)?;

        let log = reader.read_all(session_id)?;
        assert_eq!(log.len(), 2);
        Ok(())
    }

    #[test]
    fn reads_ts_style_jsonl() -> Result<()> {
        let dir = tempdir()?;
        let path = session_log_path(dir.path(), "sess-ts");
        ensure_dir_for_file(&path)?;
        let line = r#"{"id":"e1","sessionId":"sess-ts","turn":1,"at":"2026-07-31T08:00:00.000Z","kind":"user_message","text":"hi"}"#;
        fs::write(&path, format!("{line}\n"))?;

        let reader = FileSessionLogReader::new(dir.path());
        let log = reader.read_all("sess-ts")?;
        assert_eq!(log.len(), 1);
        match &log[0] {
            SessionLog::UserMessage { text, .. } => assert_eq!(text, "hi"),
            _ => panic!("expected user_message"),
        }
        Ok(())
    }

    #[test]
    fn tool_outcome_round_trip() -> Result<()> {
        let dir = tempdir()?;
        let writer = FileSessionLogWriter::new(dir.path());
        let reader = FileSessionLogReader::new(dir.path());
        let session_id = "sess-tool";

        let record = build_session_log(
            session_id,
            2,
            SessionLogBody::ToolOutcome {
                tool_use_id: "toolu_1".into(),
                result_summary: ToolResultSummary {
                    summary: "ok".into(),
                    byte_count: 2,
                    line_count: Some(1),
                    truncated: None,
                },
            },
        );
        writer.append(session_id, &record)?;

        let log = reader.read_all(session_id)?;
        assert!(matches!(log[0], SessionLog::ToolOutcome { .. }));
        Ok(())
    }
}
