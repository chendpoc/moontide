mod builtins;
mod execute;
mod names;
mod path_util;
mod permission;
mod registry;
mod summarize;

pub use execute::*;
pub use names::*;
pub use permission::*;
pub use registry::*;
pub use summarize::*;

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
}

impl ToolContext {
    pub fn new(workdir: impl Into<std::path::PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
        }
    }
}

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

pub struct ReplInteraction;

#[async_trait::async_trait]
impl UserInteraction for ReplInteraction {
    async fn approve_tool(&self, request: ApproveToolRequest) -> bool {
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
