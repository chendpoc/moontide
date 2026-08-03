use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use ocula_llm::LlmClient;
use ocula_session::Session;
use ocula_tools::UserInteraction;

use crate::agent_run::{AgentRun, LoopContext, RunResult};
use crate::loop_config::{LoopConfig, NoOpLoopConfig};

pub struct AgentSession {
    pub session: Session,
    workdir: PathBuf,
    llm: Arc<dyn LlmClient>,
    interaction: Arc<dyn UserInteraction>,
    loop_config: Arc<dyn LoopConfig>,
}

impl AgentSession {
    pub fn new(
        workdir: impl Into<PathBuf>,
        llm: Arc<dyn LlmClient>,
        interaction: Arc<dyn UserInteraction>,
    ) -> Self {
        let workdir = workdir.into();
        Self {
            session: Session::create(&workdir),
            workdir,
            llm,
            interaction,
            loop_config: Arc::new(NoOpLoopConfig),
        }
    }

    pub fn with_loop_config(mut self, loop_config: Arc<dyn LoopConfig>) -> Self {
        self.loop_config = loop_config;
        self
    }

    pub fn workdir(&self) -> &Path {
        &self.workdir
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
        };
        AgentRun::new(ctx).execute(user_prompt).await
    }
}
