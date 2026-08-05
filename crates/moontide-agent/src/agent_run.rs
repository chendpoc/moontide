use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use moontide_composer::{compose_context, ComposeOptions};
use moontide_llm::{extract_text, LlmClient};
use moontide_observability::{ObservabilityState, TraceWriter};
use moontide_protocol::ContentBlock;
use moontide_session::{ArtifactStore, Session};
use moontide_tools::{ToolProjectionConfig, UserInteraction};

use crate::loop_config::LoopConfig;
use crate::prompt::build_system_prompt;
use crate::tool_pipeline::run_tool_uses;

pub struct LoopContext {
    pub workdir: PathBuf,
    pub session: Session,
    pub interaction: Arc<dyn UserInteraction>,
    pub llm: Arc<dyn LlmClient>,
    pub loop_config: Arc<dyn LoopConfig>,
    pub obs: Arc<ObservabilityState>,
    pub projection_config: ToolProjectionConfig,
    pub artifact_store: ArtifactStore,
}

pub struct AgentRun {
    ctx: LoopContext,
}

impl AgentRun {
    pub fn new(ctx: LoopContext) -> Self {
        Self { ctx }
    }

    pub async fn execute(&self, user_prompt: &str) -> Result<RunResult> {
        self.ctx.session.append_user(1, user_prompt).await?;

        let trace = TraceWriter::new(self.ctx.obs.clone());
        let mut run_turn = 0u32;
        loop {
            run_turn += 1;
            let system = build_system_prompt(&self.ctx.workdir);
            let slice = self.ctx.session.log_slice().await?;
            let log = slice.log().to_vec();

            let session_id = self.ctx.session.session_id.clone();
            let loader_store = self.ctx.artifact_store.clone();
            let artifact_loader: moontide_composer::ArtifactLoader = Arc::new(move |id| {
                loader_store.get(&session_id, id).ok()
            });

            let mut compose_opts = ComposeOptions::from_env();
            compose_opts.config = self.ctx.projection_config.clone();
            compose_opts.artifact_loader = Some(artifact_loader);

            let mut composed = compose_context(system.clone(), &log, None, &compose_opts);
            composed.messages = self
                .ctx
                .loop_config
                .transform_context(composed.messages);

            trace.compose_summary(
                composed.messages.len(),
                composed.tools.len(),
                composed.system.len(),
                composed.truncated_count,
                composed.artifact_count,
            );
            trace.turn_start(run_turn);

            let response = self
                .ctx
                .llm
                .chat(&composed.messages, &composed.tools, &composed.system)
                .await?;

            for block in &response.content {
                match block {
                    ContentBlock::Thinking { thinking } => {
                        trace.thinking(run_turn, thinking);
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        let preview = serde_json::to_string(input).unwrap_or_default();
                        trace.tool_use(run_turn, name, &preview);
                    }
                    _ => {}
                }
            }

            self.ctx
                .session
                .append_assistant(run_turn, response.content.clone())
                .await?;

            if response.stop_reason != "tool_use" {
                return Ok(RunResult {
                    reply: extract_text(&response.content),
                    turn: run_turn,
                });
            }

            run_tool_uses(
                &response.content,
                run_turn,
                &self.ctx.session,
                &self.ctx.workdir,
                self.ctx.interaction.clone(),
                Some(trace.clone()),
                &self.ctx.artifact_store,
                &self.ctx.projection_config,
            )
            .await?;
        }
    }
}

pub struct RunResult {
    pub reply: String,
    pub turn: u32,
}
