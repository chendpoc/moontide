pub mod projection;
mod truncation_strategies;
mod approval;
mod builtins;
mod execute;
mod names;
mod path_util;
mod permission;
mod registry;
mod summarize;

pub use approval::*;
pub use execute::*;
pub use names::*;
pub use permission::*;
pub use registry::*;
pub use projection::*;
pub use summarize::*;
pub use truncation_strategies::*;

pub fn dev_tool_learning_enabled() -> bool {
    builtins::dev_tool_learning_enabled()
}

pub use builtins::{run_read_artifact, run_record_tool_hint};

use ocula_protocol::ToolSchema;

pub fn tool_definitions() -> Vec<ToolSchema> {
    registry::default_tools()
        .into_iter()
        .map(|t| t.schema)
        .collect()
}

#[derive(Clone)]
pub struct ToolContext {
    pub workdir: std::path::PathBuf,
    pub session_id: Option<String>,
}

impl ToolContext {
    pub fn new(workdir: impl Into<std::path::PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
            session_id: None,
        }
    }

    pub fn with_session(workdir: impl Into<std::path::PathBuf>, session_id: Option<String>) -> Self {
        Self {
            workdir: workdir.into(),
            session_id,
        }
    }
}

use std::sync::Arc;

pub struct ApproveToolRequest {
    pub tool_name: String,
    pub input: serde_json::Value,
}

#[async_trait::async_trait]
pub trait UserInteraction: Send + Sync {
    async fn approve_tool(&self, request: ApproveToolRequest) -> bool;
}

pub struct DenyAllInteraction;

#[async_trait::async_trait]
impl UserInteraction for DenyAllInteraction {
    async fn approve_tool(&self, _request: ApproveToolRequest) -> bool {
        false
    }
}

pub struct AutoApproveInteraction;

#[async_trait::async_trait]
impl UserInteraction for AutoApproveInteraction {
    async fn approve_tool(&self, _request: ApproveToolRequest) -> bool {
        true
    }
}

pub struct ReplInteraction {
    always_allow: Arc<AlwaysAllowState>,
}

impl ReplInteraction {
    pub fn new(always_allow: Arc<AlwaysAllowState>) -> Self {
        Self { always_allow }
    }
}

#[async_trait::async_trait]
impl UserInteraction for ReplInteraction {
    async fn approve_tool(&self, request: ApproveToolRequest) -> bool {
        if self.always_allow.is_enabled() {
            return true;
        }
        use std::io::{self, Write};
        print!(
            "Allow tool {} with {:?}? [y/N] ",
            request.tool_name, request.input
        );
        let _ = io::stdout().flush();
        let mut line = String::new();
        if io::stdin().read_line(&mut line).is_err() {
            return false;
        }
        line.trim().eq_ignore_ascii_case("y")
    }
}
