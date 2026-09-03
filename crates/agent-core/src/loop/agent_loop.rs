use std::sync::Arc;

use anyhow::{
    bail,
    Result,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::cancellation::wait_for_retry;
use super::response::{
    classify_response,
    ResponseAction,
};
use super::retry::retry_delay;
use super::tool_runtime::{
    ToolCallOutcome,
    ToolRuntime,
};
use super::turn::TurnInput;
use crate::context;
use crate::event::{
    EventDispatcher,
    LlmCallFailureKind,
    LlmCallOutcome,
    TurnEvent,
};
use crate::llm::protocol::{
    CancelReason,
    LlmError,
    ModelResponse,
    RequestFailureKind,
};
use crate::llm::{
    run_model_call_with_updates,
    LLMProvider,
};
use crate::model_input::compile;
use crate::session::SessionStore;

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
        mut input: TurnInput,
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
        ensure_not_cancelled(&cancellation)?;
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
            let mut response = None;
            let mut response_action = None;
            let mut completed_llm_call_id = None;
            for attempt in 0..=input.policy.max_llm_retries {
                ensure_not_cancelled(&cancellation)?;
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
                let attempt_result = tokio::select! {
                    biased;
                    result = run_model_call_with_updates(provider.as_ref(), request.clone(), |snapshot| {
                        let _ = self.events.emit(
                            &mut self.session,
                            TurnEvent::MessageUpdate {
                                turn,
                                step,
                                llm_call_id: llm_call_id.clone(),
                                snapshot,
                            },
                        );
                    }) => result,
                    _ = cancellation.cancelled() => {
                        Err(LlmError::Cancelled {
                            reason: CancelReason::User,
                        })
                    }
                };

                match attempt_result {
                    Ok(result) => {
                        let action = match classify_response(&result) {
                            Ok(action) => action,
                            Err(error) => {
                                self.events.emit(
                                    &mut self.session,
                                    TurnEvent::LlmCallEnded {
                                        turn,
                                        step,
                                        llm_call_id: llm_call_id.clone(),
                                        outcome: LlmCallOutcome::Failed {
                                            kind: LlmCallFailureKind::InvalidResponse,
                                        },
                                    },
                                )?;
                                return Err(error);
                            }
                        };
                        self.events.emit(
                            &mut self.session,
                            TurnEvent::LlmCallEnded {
                                turn,
                                step,
                                llm_call_id: llm_call_id.clone(),
                                outcome: LlmCallOutcome::Succeeded {
                                    stop_reason: result.stop_reason.clone(),
                                    usage: result.usage,
                                },
                            },
                        )?;
                        if let Some(response_id) = result.response_id.clone() {
                            input.config.continuity_hint.previous_response_id = Some(response_id);
                        }
                        response = Some(result);
                        response_action = Some(action);
                        completed_llm_call_id = Some(llm_call_id);
                        break;
                    }
                    Err(error) => {
                        let outcome = match &error {
                            LlmError::RequestFailed { kind, .. } => LlmCallOutcome::Failed {
                                kind: LlmCallFailureKind::Request(*kind),
                            },
                            LlmError::Cancelled { reason } => {
                                LlmCallOutcome::Cancelled { reason: *reason }
                            }
                        };
                        self.events.emit(
                            &mut self.session,
                            TurnEvent::LlmCallEnded {
                                turn,
                                step,
                                llm_call_id,
                                outcome,
                            },
                        )?;

                        match error {
                            LlmError::RequestFailed {
                                kind: RequestFailureKind::Recoverable,
                                ..
                            } if attempt < input.policy.max_llm_retries => {
                                wait_for_retry(&cancellation, retry_delay(attempt)).await?;
                            }
                            error => return Err(anyhow::Error::new(error)),
                        }
                    }
                }
            }

            let response =
                response.ok_or_else(|| anyhow::anyhow!("LLM step produced no response"))?;
            let response_action = response_action
                .ok_or_else(|| anyhow::anyhow!("LLM step produced no response action"))?;
            let llm_call_id = completed_llm_call_id
                .ok_or_else(|| anyhow::anyhow!("LLM step produced no call identity"))?;

            match response_action {
                ResponseAction::Terminal { assistant_blocks } => {
                    self.events.emit(
                        &mut self.session,
                        TurnEvent::AssistantFinalized {
                            turn,
                            llm_call_id: llm_call_id.clone(),
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
                    self.events.emit(
                        &mut self.session,
                        TurnEvent::AssistantFinalized {
                            turn,
                            llm_call_id: llm_call_id.clone(),
                            blocks: assistant_blocks,
                        },
                    )?;
                    for call in &calls {
                        self.events.emit(
                            &mut self.session,
                            TurnEvent::ToolCallRecorded {
                                turn,
                                call: call.clone(),
                            },
                        )?;
                    }

                    if let Some(error) = self
                        .process_tool_round(turn, &calls, &working_dir, &cancellation)
                        .await?
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
        cancellation: &CancellationToken,
    ) -> Result<Option<anyhow::Error>> {
        for (index, call) in calls.iter().enumerate() {
            let outcome = self
                .tools
                .execute_call(call, working_dir, cancellation)
                .await;
            let (result, error) = match outcome {
                ToolCallOutcome::Result(result) => (result, None),
                ToolCallOutcome::Abort { result, error } => (
                    result,
                    Some(error.unwrap_or_else(|| anyhow::anyhow!("tool call cancelled"))),
                ),
            };
            let result_commit = self.events.emit(
                &mut self.session,
                TurnEvent::ToolResultRecorded { turn, result },
            );

            if let Err(commit_error) = result_commit {
                let cleanup_errors = self.commit_parent_results(turn, calls, index + 1);
                let mut details = vec![format!("tool result commit failed: {commit_error:#}")];
                details.extend(
                    cleanup_errors
                        .iter()
                        .map(|error| format!("cleanup commit failed: {error:#}")),
                );
                let combined = anyhow::anyhow!(details.join("; "));
                return Ok(Some(match error {
                    Some(error) => error.context(combined.to_string()),
                    None => combined,
                }));
            }

            if let Some(error) = error {
                let cleanup_errors = self.commit_parent_results(turn, calls, index + 1);
                if cleanup_errors.is_empty() {
                    return Ok(Some(error));
                }
                let details = cleanup_errors
                    .iter()
                    .map(|error| format!("cleanup commit failed: {error:#}"))
                    .collect::<Vec<_>>()
                    .join("; ");
                return Ok(Some(
                    error.context(format!("tool round cleanup failed: {details}")),
                ));
            }
        }
        Ok(None)
    }

    fn commit_parent_results(
        &mut self,
        turn: u64,
        calls: &[crate::tools::ToolCall],
        start: usize,
    ) -> Vec<anyhow::Error> {
        let mut errors = Vec::new();
        for remaining in calls.iter().skip(start) {
            let result = crate::tools::ToolResult::with_status(
                remaining,
                crate::tools::ToolResultStatus::Cancelled {
                    reason: crate::tools::ToolCancellationReason::Parent,
                },
                crate::tools::ToolContent::Text("parent tool call was cancelled".into()),
            );
            if let Err(error) = self.events.emit(
                &mut self.session,
                TurnEvent::ToolResultRecorded { turn, result },
            ) {
                errors.push(error);
            }
        }
        errors
    }
}

fn ensure_not_cancelled(token: &CancellationToken) -> Result<()> {
    if token.is_cancelled() {
        bail!("turn cancelled");
    }
    Ok(())
}
