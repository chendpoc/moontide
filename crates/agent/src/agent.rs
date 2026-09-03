use std::path::{
    Path,
    PathBuf,
};

use agent_core::llm::profile_config::ContinuityHint;
use agent_core::llm::protocol::{
    ModelResponse,
    ThinkingLevel,
};
use agent_core::r#loop::{
    AgentLoop,
    ToolPermissionMap,
    TurnInput,
    TurnPolicy,
};
use agent_core::model_input::LlmCallConfig;
use anyhow::{
    Context,
    Result,
    bail,
};
use tokio_util::sync::CancellationToken;

use crate::config::AgentConfig;
use crate::log::{
    AgentEventLogHandle,
    AgentEventLogStatus,
};
use crate::progress::{
    ProgressHandle,
    ProgressStatus,
};
use crate::{
    bootstrap,
    prompt,
};

/// Facade that owns one session's complete agent runtime.
pub struct Agent {
    loop_: AgentLoop,
    session_id: String,
    call_config: LlmCallConfig,
    max_steps: u32,
    cwd: PathBuf,
    tool_names: Vec<String>,
    permissions: ToolPermissionMap,
    approval_configured: bool,
    agent_event_log_handle: Option<AgentEventLogHandle>,
    progress_handle: Option<ProgressHandle>,
}

pub(crate) struct AgentParts {
    pub(crate) loop_: AgentLoop,
    pub(crate) session_id: String,
    pub(crate) cwd: PathBuf,
    pub(crate) agent_event_log_handle: Option<AgentEventLogHandle>,
    pub(crate) progress_handle: Option<ProgressHandle>,
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

    pub async fn reload(&mut self, config: AgentConfig) -> Result<()> {
        bootstrap::ensure_runtime()?;
        config.validate_values()?;
        config.ensure_paths()?;
        self.flush_agent_event_log()
            .await
            .context("flush diagnostic Agent Event Log before reload")?;
        let session_id = self.session_id.clone();
        let parts = bootstrap::resume(&config, &session_id)?;
        self.apply_parts(config, parts);
        Ok(())
    }

    pub fn apply_turn_limits(
        &mut self,
        max_steps: u32,
        max_tokens: u32,
        thinking_level: Option<ThinkingLevel>,
    ) -> Result<()> {
        if max_steps == 0 {
            bail!("max_steps must be greater than zero");
        }
        if max_tokens == 0 {
            bail!("max_tokens must be greater than zero");
        }
        self.max_steps = max_steps;
        self.call_config.max_tokens = max_tokens;
        self.call_config.thinking_level = thinking_level;
        Ok(())
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    /// Drains progress events before a host renders a completed turn or exits.
    pub async fn flush_progress(&self) -> Result<()> {
        if let Some(handle) = &self.progress_handle {
            handle.flush().await?;
        }
        Ok(())
    }

    /// Returns and clears whether progress delivery lost events and needs resync.
    pub fn take_progress_resync_required(&self) -> bool {
        self.progress_handle
            .as_ref()
            .is_some_and(ProgressHandle::take_resync_required)
    }

    /// Returns the current ProgressWorker status, if progress is configured.
    pub fn progress_status(&self) -> Option<ProgressStatus> {
        self.progress_handle.as_ref().map(ProgressHandle::status)
    }

    /// Drains diagnostic Agent Event records before a host renders or exits.
    pub async fn flush_agent_event_log(&self) -> Result<()> {
        if let Some(handle) = &self.agent_event_log_handle {
            handle.flush().await?;
        }
        Ok(())
    }

    /// Returns the current diagnostic Agent Event Log worker status.
    pub fn agent_event_log_status(&self) -> Option<AgentEventLogStatus> {
        self.agent_event_log_handle
            .as_ref()
            .map(AgentEventLogHandle::status)
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
        let mut config = self.call_config.clone();
        config.session_id = Some(self.session_id.clone());
        let input = TurnInput {
            text,
            config,
            system_prompt,
            policy: TurnPolicy::new(self.max_steps)?,
        };
        let response = self.loop_.turn(input, cancellation).await?;
        if let Some(response_id) = response.response_id.clone() {
            self.call_config.continuity_hint.previous_response_id = Some(response_id);
        }
        Ok(response)
    }

    fn from_parts(config: AgentConfig, parts: AgentParts) -> Result<Self> {
        Ok(Self {
            loop_: parts.loop_,
            session_id: parts.session_id,
            call_config: config.provider.to_call_config(
                config.max_tokens,
                config.thinking_level,
                None,
                ContinuityHint::default(),
            ),
            max_steps: config.max_steps,
            cwd: parts.cwd,
            tool_names: config.tool_names,
            permissions: config.permissions,
            approval_configured: config.approval.is_some(),
            agent_event_log_handle: parts.agent_event_log_handle,
            progress_handle: parts.progress_handle,
        })
    }

    fn apply_parts(&mut self, config: AgentConfig, parts: AgentParts) {
        self.loop_ = parts.loop_;
        self.cwd = parts.cwd;
        let continuity_hint = if self.call_config.protocol == config.provider.protocol {
            self.call_config.continuity_hint.clone()
        } else {
            ContinuityHint::default()
        };
        self.call_config = config.provider.to_call_config(
            config.max_tokens,
            config.thinking_level,
            None,
            continuity_hint,
        );
        self.max_steps = config.max_steps;
        self.tool_names = config.tool_names;
        self.permissions = config.permissions;
        self.approval_configured = config.approval.is_some();
        self.agent_event_log_handle = parts.agent_event_log_handle;
        self.progress_handle = parts.progress_handle;
    }
}

#[cfg(test)]
impl Agent {
    pub(crate) fn continuity_hint_for_test(&self) -> ContinuityHint {
        self.call_config.continuity_hint.clone()
    }

    pub(crate) fn set_continuity_hint_for_test(&mut self, hint: ContinuityHint) {
        self.call_config.continuity_hint = hint;
    }
}
