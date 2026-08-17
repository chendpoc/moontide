use std::path::PathBuf;

use agent_core::{
    llm::protocol::{ModelResponse, ThinkingLevel},
    model_input::ModelRequestConfig,
    r#loop::{AgentLoop, ToolPermissionMap, TurnInput, TurnPolicy},
};
use anyhow::Result;
use tokio_util::sync::CancellationToken;

use crate::{bootstrap, config::AgentConfig, prompt};

/// Facade that owns one session's complete agent runtime.
pub struct Agent {
    loop_: AgentLoop,
    session_id: String,
    model: String,
    max_tokens: u32,
    thinking_level: Option<ThinkingLevel>,
    max_steps: u32,
    cwd: PathBuf,
    tool_names: Vec<String>,
    permissions: ToolPermissionMap,
    approval_configured: bool,
}

pub(crate) struct AgentParts {
    pub(crate) loop_: AgentLoop,
    pub(crate) session_id: String,
    pub(crate) cwd: PathBuf,
}

impl Agent {
    pub fn create(config: AgentConfig) -> Result<Self> {
        let parts = bootstrap::create(&config)?;
        Self::from_parts(config, parts)
    }

    pub fn resume(config: AgentConfig, session_id: &str) -> Result<Self> {
        let parts = bootstrap::resume(&config, session_id)?;
        Self::from_parts(config, parts)
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub async fn turn(
        &mut self,
        text: String,
        cancellation: CancellationToken,
    ) -> Result<ModelResponse> {
        let system_prompt = prompt::resolve(
            &self.cwd,
            &self.session_id,
            &self.tool_names,
            &self.permissions,
            self.approval_configured,
        )?;
        let input = TurnInput {
            text,
            config: ModelRequestConfig {
                model: self.model.clone(),
                max_tokens: self.max_tokens,
                thinking_level: self.thinking_level,
                session_id: Some(self.session_id.clone()),
            },
            system_prompt,
            policy: TurnPolicy::new(self.max_steps)?,
        };
        self.loop_.turn(input, cancellation).await
    }

    fn from_parts(config: AgentConfig, parts: AgentParts) -> Result<Self> {
        Ok(Self {
            loop_: parts.loop_,
            session_id: parts.session_id,
            model: config.model,
            max_tokens: config.max_tokens,
            thinking_level: config.thinking_level,
            max_steps: config.max_steps,
            cwd: parts.cwd,
            tool_names: config.tool_names,
            permissions: config.permissions,
            approval_configured: config.approval.is_some(),
        })
    }
}
