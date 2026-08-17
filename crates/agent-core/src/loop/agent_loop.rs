use std::sync::Arc;

use anyhow::{bail, Result};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    context,
    event::{EventDispatcher, TurnEvent},
    llm::{protocol::ModelResponse, run_model_call_with_updates, LLMProvider},
    model_input::compile,
    session::SessionStore,
};

use super::{response::terminal_assistant_blocks, tool_runtime::ToolRuntime, turn::TurnInput};

pub struct AgentLoopInit {
    pub session: SessionStore,
    pub provider: Arc<dyn LLMProvider>,
    pub tools: ToolRuntime,
    pub events: EventDispatcher,
}

pub struct AgentLoop {
    session: SessionStore,
    provider: Arc<dyn LLMProvider>,
    tools: ToolRuntime,
    events: EventDispatcher,
}

impl AgentLoop {
    pub fn new(init: AgentLoopInit) -> Self {
        Self {
            session: init.session,
            provider: init.provider,
            tools: init.tools,
            events: init.events,
        }
    }

    pub async fn turn(
        &mut self,
        input: TurnInput,
        cancellation: CancellationToken,
    ) -> Result<ModelResponse> {
        input.policy.validate()?;
        if input.text.is_empty() {
            bail!("turn user text must not be empty");
        }
        ensure_not_cancelled(&cancellation)?;
        context::materialize(self.session.items())?;
        let turn = self.session.next_turn()?;
        ensure_not_cancelled(&cancellation)?;

        self.events
            .emit(&mut self.session, TurnEvent::TurnStarted { turn })?;
        self.events.emit(
            &mut self.session,
            TurnEvent::UserPromptCommitted {
                turn,
                text: input.text,
            },
        )?;

        let step = 0;
        ensure_not_cancelled(&cancellation)?;
        let messages = context::materialize(self.session.items())?;
        let request = compile(
            &input.config,
            &input.system_prompt,
            messages,
            &self.tools.registry,
        );
        let llm_call_id = Uuid::new_v4().to_string();

        self.events.emit(
            &mut self.session,
            TurnEvent::LlmCallStarted {
                turn,
                step,
                llm_call_id: llm_call_id.clone(),
            },
        )?;

        let provider = Arc::clone(&self.provider);
        let response = run_model_call_with_updates(provider.as_ref(), request, |snapshot| {
            let _ = self.events.emit(
                &mut self.session,
                TurnEvent::MessageUpdate {
                    turn,
                    step,
                    llm_call_id: llm_call_id.clone(),
                    snapshot,
                },
            );
        })
        .await
        .map_err(|error| anyhow::anyhow!(error))?;

        self.events.emit(
            &mut self.session,
            TurnEvent::LlmCallEnded {
                turn,
                step,
                llm_call_id,
                stop_reason: response.stop_reason.clone(),
                usage: response.usage,
            },
        )?;

        let blocks = terminal_assistant_blocks(&response)?;
        self.events.emit(
            &mut self.session,
            TurnEvent::AssistantFinalized { turn, blocks },
        )?;
        self.events
            .emit(&mut self.session, TurnEvent::TurnEnded { turn })?;
        Ok(response)
    }
}

fn ensure_not_cancelled(token: &CancellationToken) -> Result<()> {
    if token.is_cancelled() {
        bail!("turn cancelled");
    }
    Ok(())
}
