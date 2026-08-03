use anyhow::Result;
use ocula_protocol::{ContentBlock, SessionLogBody, ToolResultSummary};
use serde_json::Value;

use crate::ids::new_session_id;
use crate::log_io::{build_session_log, FileSessionLogReader, FileSessionLogWriter};
use crate::slice::SessionLogSlice;

pub struct Session {
    pub session_id: String,
    workdir: std::path::PathBuf,
}

impl Session {
    pub fn create(workdir: impl Into<std::path::PathBuf>) -> Self {
        Self {
            session_id: new_session_id(),
            workdir: workdir.into(),
        }
    }

    pub fn open(session_id: impl Into<String>, workdir: impl Into<std::path::PathBuf>) -> Self {
        Self {
            session_id: session_id.into(),
            workdir: workdir.into(),
        }
    }

    fn writer(&self) -> FileSessionLogWriter {
        FileSessionLogWriter::new(&self.workdir)
    }

    fn reader(&self) -> FileSessionLogReader {
        FileSessionLogReader::new(&self.workdir)
    }

    async fn append_body(&self, turn: u32, body: SessionLogBody) -> Result<()> {
        let record = build_session_log(&self.session_id, turn, body);
        self.writer().append(&self.session_id, &record)
    }

    pub async fn append_user(&self, turn: u32, text: impl Into<String>) -> Result<()> {
        self.append_body(
            turn,
            SessionLogBody::UserMessage {
                text: text.into(),
            },
        )
        .await
    }

    pub async fn append_assistant(&self, turn: u32, blocks: Vec<ContentBlock>) -> Result<()> {
        self.append_body(turn, SessionLogBody::AssistantMessage { blocks })
            .await
    }

    pub async fn append_tool_invocation(
        &self,
        turn: u32,
        tool_use_id: impl Into<String>,
        name: impl Into<String>,
        input: Value,
    ) -> Result<()> {
        self.append_body(
            turn,
            SessionLogBody::ToolInvocation {
                tool_use_id: tool_use_id.into(),
                name: name.into(),
                input,
            },
        )
        .await
    }

    pub async fn append_tool_outcome(
        &self,
        turn: u32,
        tool_use_id: impl Into<String>,
        result_summary: ToolResultSummary,
    ) -> Result<()> {
        self.append_body(
            turn,
            SessionLogBody::ToolOutcome {
                tool_use_id: tool_use_id.into(),
                result_summary,
            },
        )
        .await
    }

    pub async fn read_log(&self) -> Result<Vec<ocula_protocol::SessionLog>> {
        self.reader().read_all(&self.session_id)
    }

    pub async fn log_slice(&self) -> Result<SessionLogSlice> {
        Ok(SessionLogSlice::from_log(self.read_log().await?))
    }
}
