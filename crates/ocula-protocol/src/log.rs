use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::content::ContentBlock;
use crate::routing::RoutingDecision;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogBase {
    pub id: String,
    pub session_id: String,
    pub turn: u32,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultSummary {
    pub summary: String,
    pub byte_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionKind {
    Prune,
    TailWindow,
    Summary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionLog {
    UserMessage {
        #[serde(flatten)]
        base: SessionLogBase,
        text: String,
    },
    AssistantMessage {
        #[serde(flatten)]
        base: SessionLogBase,
        blocks: Vec<ContentBlock>,
    },
    ToolInvocation {
        #[serde(flatten)]
        base: SessionLogBase,
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        name: String,
        input: Value,
    },
    ToolOutcome {
        #[serde(flatten)]
        base: SessionLogBase,
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        #[serde(rename = "artifactId", skip_serializing_if = "Option::is_none")]
        artifact_id: Option<String>,
        #[serde(rename = "resultSummary")]
        result_summary: ToolResultSummary,
    },
    Compaction {
        #[serde(flatten)]
        base: SessionLogBase,
        compaction_kind: CompactionKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        compaction_record_id: Option<String>,
        excluded_log_ids: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        before_tokens: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        after_tokens: Option<u32>,
    },
    CheckpointCreated {
        #[serde(flatten)]
        base: SessionLogBase,
        checkpoint_id: String,
    },
    Routing {
        #[serde(flatten)]
        base: SessionLogBase,
        decision: RoutingDecision,
    },
}

impl SessionLog {
    pub fn base(&self) -> &SessionLogBase {
        match self {
            Self::UserMessage { base, .. }
            | Self::AssistantMessage { base, .. }
            | Self::ToolInvocation { base, .. }
            | Self::ToolOutcome { base, .. }
            | Self::Compaction { base, .. }
            | Self::CheckpointCreated { base, .. }
            | Self::Routing { base, .. } => base,
        }
    }

    pub fn turn(&self) -> u32 {
        self.base().turn
    }
}

#[derive(Debug, Clone)]
pub enum SessionLogBody {
    UserMessage { text: String },
    AssistantMessage { blocks: Vec<ContentBlock> },
    ToolInvocation {
        tool_use_id: String,
        name: String,
        input: Value,
    },
    ToolOutcome {
        tool_use_id: String,
        artifact_id: Option<String>,
        result_summary: ToolResultSummary,
    },
}

pub fn is_session_log(value: &Value) -> bool {
    value
        .get("kind")
        .and_then(|k| k.as_str())
        .is_some_and(|kind| {
            matches!(
                kind,
                "user_message"
                    | "assistant_message"
                    | "tool_invocation"
                    | "tool_outcome"
                    | "compaction"
                    | "checkpoint_created"
                    | "routing"
            )
        })
}
