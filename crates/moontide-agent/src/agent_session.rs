use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use moontide_llm::LlmClient;
use moontide_observability::ObservabilityState;
use moontide_session::{ArtifactStore, Session};
use moontide_tools::{ToolProjectionConfig, UserInteraction};

use crate::agent_run::{AgentRun, LoopContext, RunResult};
use crate::loop_config::{LoopConfig, PruneLoopConfig};

pub struct AgentSession {
    pub session: Session,
    workdir: PathBuf,
    llm: Arc<dyn LlmClient>,
    interaction: Arc<dyn UserInteraction>,
    loop_config: Arc<dyn LoopConfig>,
    obs: Arc<ObservabilityState>,
    projection_config: ToolProjectionConfig,
    artifact_store: ArtifactStore,
}

impl AgentSession {
    pub fn new(
        workdir: impl Into<PathBuf>,
        llm: Arc<dyn LlmClient>,
        interaction: Arc<dyn UserInteraction>,
        obs: Arc<ObservabilityState>,
    ) -> Self {
        let workdir = workdir.into();
        Self {
            session: Session::create(&workdir),
            workdir: workdir.clone(),
            llm,
            interaction,
            loop_config: Arc::new(PruneLoopConfig::default()),
            obs,
            projection_config: ToolProjectionConfig::from_env(),
            artifact_store: ArtifactStore::new(workdir),
        }
    }

    pub fn with_loop_config(mut self, loop_config: Arc<dyn LoopConfig>) -> Self {
        self.loop_config = loop_config;
        self
    }

    pub fn workdir(&self) -> &Path {
        &self.workdir
    }

    pub fn observability(&self) -> Arc<ObservabilityState> {
        self.obs.clone()
    }

    pub fn reset_session(&mut self) {
        self.session = Session::create(&self.workdir);
    }

    pub async fn run(&self, user_prompt: &str) -> Result<RunResult> {
        let ctx = LoopContext {
            workdir: self.workdir.clone(),
            session: Session::open(self.session.session_id.clone(), &self.workdir),
            interaction: self.interaction.clone(),
            llm: self.llm.clone(),
            loop_config: self.loop_config.clone(),
            obs: self.obs.clone(),
            projection_config: self.projection_config.clone(),
            artifact_store: self.artifact_store.clone(),
        };
        AgentRun::new(ctx).execute(user_prompt).await
    }
}
