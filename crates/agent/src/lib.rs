//! MoonTide's composition root for one persistent agent session.

mod agent;
mod bootstrap;
mod config;
mod prompt;

pub use agent::Agent;
pub use agent_core::{
    llm::{
        adapter::AdapterFamily,
        protocol::{ContentBlock, ModelResponse, StopReason, ThinkingLevel},
    },
    r#loop::{ToolApproval, ToolApprovalHandler, ToolPermission, ToolPermissionMap},
    tools::ToolCall,
};
pub use config::{AgentConfig, ProviderConfig};

#[cfg(test)]
mod tests;
