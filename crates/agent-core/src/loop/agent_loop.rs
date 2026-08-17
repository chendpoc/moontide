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

use super::{
    response::{classify_response, ResponseAction},
    tool_runtime::{ToolCallOutcome, ToolRuntime},
    turn::TurnInput,
};

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

        let working_dir = self.session.header().cwd.clone();
        for step in 0..input.policy.max_steps {
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

            match classify_response(&response)? {
                ResponseAction::Terminal { assistant_blocks } => {
                    self.events.emit(
                        &mut self.session,
                        TurnEvent::AssistantFinalized {
                            turn,
                            blocks: assistant_blocks,
                        },
                    )?;
                    self.events
                        .emit(&mut self.session, TurnEvent::TurnEnded { turn })?;
                    return Ok(response);
                }
                ResponseAction::ToolRound {
                    assistant_blocks,
                    calls,
                } => {
                    if !assistant_blocks.is_empty() {
                        self.events.emit(
                            &mut self.session,
                            TurnEvent::AssistantFinalized {
                                turn,
                                blocks: assistant_blocks,
                            },
                        )?;
                    }
                    for call in &calls {
                        self.events.emit(
                            &mut self.session,
                            TurnEvent::ToolCallRecorded {
                                turn,
                                call: call.clone(),
                            },
                        )?;
                    }

                    if let Some(error) = self.process_tool_round(turn, &calls, &working_dir).await?
                    {
                        return Err(error);
                    }
                    if step + 1 == input.policy.max_steps {
                        self.events
                            .emit(&mut self.session, TurnEvent::TurnEnded { turn })?;
                        bail!("turn exhausted max_steps after closing Tool round");
                    }
                }
            }
        }

        bail!("turn exhausted max_steps without a terminal response")
    }

    async fn process_tool_round(
        &mut self,
        turn: u64,
        calls: &[crate::tools::ToolCall],
        working_dir: &std::path::Path,
    ) -> Result<Option<anyhow::Error>> {
        for (index, call) in calls.iter().enumerate() {
            let outcome = self.tools.execute_call(call, working_dir).await;
            let (result, error) = match outcome {
                ToolCallOutcome::Result(result) => (result, None),
                ToolCallOutcome::Abort { result, error } => (
                    result,
                    Some(error.unwrap_or_else(|| anyhow::anyhow!("tool call cancelled"))),
                ),
            };
            self.events.emit(
                &mut self.session,
                TurnEvent::ToolResultRecorded { turn, result },
            )?;

            if let Some(error) = error {
                for remaining in calls.iter().skip(index + 1) {
                    let result = crate::tools::ToolResult::with_status(
                        remaining,
                        crate::tools::ToolResultStatus::Cancelled {
                            reason: crate::tools::ToolCancellationReason::Parent,
                        },
                        crate::tools::ToolContent::Text("parent tool call was cancelled".into()),
                    );
                    self.events.emit(
                        &mut self.session,
                        TurnEvent::ToolResultRecorded { turn, result },
                    )?;
                }
                return Ok(Some(error));
            }
        }
        Ok(None)
    }
}

fn ensure_not_cancelled(token: &CancellationToken) -> Result<()> {
    if token.is_cancelled() {
        bail!("turn cancelled");
    }
    Ok(())
}
