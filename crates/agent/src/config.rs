use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use agent_core::llm::protocol::ThinkingLevel;
use agent_core::r#loop::{
    ToolApprovalHandler,
    ToolPermissionMap,
};
use anyhow::{
    bail,
    Context,
    Result,
};
use serde::{
    Deserialize,
    Serialize,
};

use crate::llm::ResolvedProviderConfig;
use crate::progress::ProgressEvent;

/// Fully resolved settings for constructing one [`crate::Agent`].
pub struct AgentConfig {
    pub cwd: PathBuf,
    pub sessions_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub provider: ResolvedProviderConfig,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub max_steps: u32,
    pub tool_names: Vec<String>,
    pub permissions: ToolPermissionMap,
    pub approval: Option<Arc<dyn ToolApprovalHandler>>,
    pub progress: Option<Arc<dyn ProgressObserver>>,
    pub persistence: PersistenceConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionPersistence {
    Items,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticPersistence {
    Off,
    Errors,
    Normal,
    Debug,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistenceConfig {
    pub session: SessionPersistence,
    pub diagnostic: DiagnosticPersistence,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            session: SessionPersistence::Items,
            diagnostic: DiagnosticPersistence::Off,
        }
    }
}

impl PersistenceConfig {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.session != SessionPersistence::Items {
            bail!("session persistence {:?} is not implemented", self.session);
        }
        Ok(())
    }
}

/// Receives safe semantic progress events without influencing agent decisions.
pub trait ProgressObserver: Send + Sync {
    fn on_progress(&self, event: &ProgressEvent) -> Result<()>;
}

impl AgentConfig {
    pub(crate) fn validate_values(&self) -> Result<()> {
        self.persistence.validate()?;
        if self.provider.base_url.trim().is_empty() {
            bail!("provider base_url must not be empty");
        }
        if self.provider.model.trim().is_empty() {
            bail!("model must not be empty");
        }
        if self.max_tokens == 0 {
            bail!("max_tokens must be greater than zero");
        }
        if self.max_steps == 0 {
            bail!("max_steps must be greater than zero");
        }

        let mut names = BTreeSet::new();
        for name in &self.tool_names {
            if !names.insert(name) {
                bail!("duplicate configured tool: {name}");
            }
        }
        Ok(())
    }

    pub(crate) fn ensure_paths(&self) -> Result<()> {
        if !self.cwd.is_dir() {
            bail!(
                "working directory is not a directory: {}",
                self.cwd.display()
            );
        }
        ensure_directory(&self.sessions_dir, "sessions")?;
        ensure_directory(&self.runs_dir, "runs")?;
        Ok(())
    }
}

fn ensure_directory(path: &PathBuf, label: &str) -> Result<()> {
    if path.exists() && !path.is_dir() {
        bail!("{label} path is not a directory: {}", path.display());
    }
    fs::create_dir_all(path)
        .with_context(|| format!("create {label} directory {}", path.display()))?;
    Ok(())
}
