use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use ocula_composer::compose_context_v1;
use ocula_llm::{extract_text, LlmClient};
use ocula_protocol::ContentBlock;
use ocula_session::Session;
use ocula_tools::UserInteraction;

use crate::loop_config::LoopConfig;
use crate::prompt::build_system_prompt;
use crate::tool_pipeline::run_tool_uses;

pub struct LoopContext {
    pub workdir: PathBuf,
    pub session: Session,
    pub interaction: Arc<dyn UserInteraction>,
    pub llm: Arc<dyn LlmClient>,
    pub loop_config: Arc<dyn LoopConfig>,
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

        let mut run_turn = 0u32;
        loop {
            run_turn += 1;
            let system = build_system_prompt(&self.ctx.workdir);
            let slice = self.ctx.session.log_slice().await?;
            let mut messages = slice.to_messages(None);
            messages = self.ctx.loop_config.transform_context(messages);

            let composed = compose_context_v1(system, messages);
            let response = self
                .ctx
                .llm
                .chat(&composed.messages, &composed.tools, &composed.system)
                .await?;

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
            )
            .await?;
        }
    }
}

pub struct RunResult {
    pub reply: String,
    pub turn: u32,
}
