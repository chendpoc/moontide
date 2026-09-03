use std::sync::{
    Arc,
    Mutex,
};

use anyhow::Result;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::super::approval::ApprovalBroker;
use super::super::command::{
    DesktopCommandError,
    HostCommand,
};
use super::super::event::{
    DesktopEvent,
    EventBuffer,
};
use super::super::state::{
    DesktopError,
    DesktopErrorKind,
    DesktopRunState,
    DesktopSnapshot,
    ShutdownReport,
};

pub(super) struct ActiveTurn {
    pub(super) turn: u64,
    pub(super) cancellation: CancellationToken,
    pub(super) join: JoinHandle<(agent::Agent, Result<agent::ModelResponse>)>,
}

pub(super) struct HostActor {
    pub(super) agent: Option<agent::Agent>,
    pub(super) session_id: String,
    pub(super) query: agent::SessionQuery,
    pub(super) broker: Arc<ApprovalBroker>,
    pub(super) buffer: Arc<EventBuffer>,
    pub(super) shared_state: Arc<Mutex<DesktopRunState>>,
    pub(super) receiver: mpsc::Receiver<HostCommand>,
    pub(super) state: DesktopRunState,
    pub(super) next_turn: u64,
    pub(super) active: Option<ActiveTurn>,
}

impl HostActor {
    pub(super) async fn run(mut self) {
        loop {
            if let Some(active) = self.active.as_mut() {
                tokio::select! {
                    command = self.receiver.recv() => {
                        if let Some(command) = command {
                            if self.handle_command(command).await {
                                break;
                            }
                        } else {
                            let _ = self.shutdown_internal().await;
                            break;
                        }
                    }
                    result = &mut active.join => {
                        if let Some(active) = self.active.take() {
                            self.finish_turn(active.turn, active.cancellation, result).await;
                        }
                    }
                }
            } else {
                match self.receiver.recv().await {
                    Some(command) => {
                        if self.handle_command(command).await {
                            break;
                        }
                    }
                    None => {
                        let _ = self.shutdown_internal().await;
                        break;
                    }
                }
            }
        }
    }

    async fn handle_command(&mut self, command: HostCommand) -> bool {
        match command {
            HostCommand::SubmitTurn { text, reply } => {
                let result = self.start_turn(text);
                let _ = reply.send(result);
            }
            HostCommand::CancelTurn { reply } => {
                let result = match self.active.as_ref() {
                    Some(active) => {
                        let turn = active.turn;
                        active.cancellation.cancel();
                        self.update_state(DesktopRunState::Cancelling { turn });
                        let _ = self.buffer.publish(
                            &self.session_id,
                            DesktopEvent::StateChanged {
                                state: self.state.clone(),
                            },
                        );
                        Ok(turn)
                    }
                    None => Err(DesktopCommandError::NoActiveTurn),
                };
                let _ = reply.send(result);
            }
            HostCommand::Approve { request_id, reply } => {
                let _ = reply.send(self.broker.approve(&request_id));
            }
            HostCommand::Deny {
                request_id,
                reason,
                reply,
            } => {
                let _ = reply.send(self.broker.deny(&request_id, reason));
            }
            HostCommand::Snapshot { reply } => {
                let _ = reply.send(self.snapshot());
            }
            HostCommand::Shutdown { reply } => {
                let report = self.shutdown_internal().await;
                let _ = reply.send(report);
                return true;
            }
        }
        false
    }

    pub(super) fn start_turn(&mut self, text: String) -> Result<u64, DesktopCommandError> {
        if text.trim().is_empty() {
            return Err(DesktopCommandError::InvalidInput(
                "turn text must not be empty".into(),
            ));
        }
        if self.active.is_some() {
            return Err(DesktopCommandError::Busy);
        }
        if !matches!(
            self.state,
            DesktopRunState::Idle | DesktopRunState::Failed { .. }
        ) {
            return Err(match self.state {
                DesktopRunState::Stopping => DesktopCommandError::Stopping,
                DesktopRunState::Stopped => DesktopCommandError::Stopped,
                _ => DesktopCommandError::Busy,
            });
        }

        let turn = self.next_turn;
        self.next_turn = self.next_turn.saturating_add(1);
        self.broker.set_turn(turn);
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let mut agent = self
            .agent
            .take()
            .ok_or_else(|| DesktopCommandError::Internal("Agent owner is unavailable".into()))?;
        let join = tokio::spawn(async move {
            let result = agent.turn(text, task_cancellation).await;
            (agent, result)
        });
        self.active = Some(ActiveTurn {
            turn,
            cancellation,
            join,
        });
        self.update_state(DesktopRunState::Thinking { turn, step: 0 });
        let _ = self.buffer.publish(
            &self.session_id,
            DesktopEvent::StateChanged {
                state: self.state.clone(),
            },
        );
        Ok(turn)
    }

    pub(super) async fn finish_turn(
        &mut self,
        turn: u64,
        cancellation: CancellationToken,
        result: std::result::Result<
            (agent::Agent, Result<agent::ModelResponse>),
            tokio::task::JoinError,
        >,
    ) {
        let (agent, response) = match result {
            Ok(result) => result,
            Err(error) => {
                self.update_state(DesktopRunState::Failed {
                    turn: Some(turn),
                    error: DesktopError {
                        kind: DesktopErrorKind::Internal,
                        message: error.to_string(),
                        recoverable: false,
                    },
                });
                let _ = self.buffer.publish(
                    &self.session_id,
                    DesktopEvent::StateChanged {
                        state: self.state.clone(),
                    },
                );
                return;
            }
        };
        self.agent = Some(agent);
        self.broker.cancel_all();
        match response {
            Ok(response) => {
                self.update_state(DesktopRunState::Idle);
                let _ = self.buffer.publish(
                    &self.session_id,
                    DesktopEvent::TurnCompleted { turn, response },
                );
            }
            Err(error) => {
                let kind = if cancellation.is_cancelled() {
                    DesktopErrorKind::Cancelled
                } else {
                    DesktopErrorKind::Provider
                };
                let desktop_error = DesktopError {
                    kind,
                    message: error.to_string(),
                    recoverable: true,
                };
                self.update_state(DesktopRunState::Failed {
                    turn: Some(turn),
                    error: desktop_error.clone(),
                });
                let _ = self.buffer.publish(
                    &self.session_id,
                    DesktopEvent::TurnFailed {
                        turn,
                        error: desktop_error,
                    },
                );
            }
        }
        let _ = self.buffer.publish(
            &self.session_id,
            DesktopEvent::StateChanged {
                state: self.state.clone(),
            },
        );
    }

    fn snapshot(&self) -> Result<DesktopSnapshot, DesktopCommandError> {
        let session = self
            .query
            .load(&self.session_id)
            .map_err(|error| DesktopCommandError::Internal(error.to_string()))?;
        let delivery = self.buffer.status();
        self.buffer.acknowledge_resync();
        let state = self
            .shared_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        Ok(DesktopSnapshot {
            session,
            state,
            pending_approvals: self.broker.pending_requests(),
            active_assistant_calls: self.buffer.active_assistant_calls(),
            delivery,
        })
    }

    async fn shutdown_internal(&mut self) -> Result<ShutdownReport, DesktopCommandError> {
        self.update_state(DesktopRunState::Stopping);
        let _ = self.buffer.publish(
            &self.session_id,
            DesktopEvent::StateChanged {
                state: self.state.clone(),
            },
        );
        let cancelled_turn = self.active.as_ref().map(|active| {
            active.cancellation.cancel();
            active.turn
        });
        if let Some(active) = self.active.take()
            && let Ok((agent, _)) = active.join.await
        {
            self.agent = Some(agent);
        }
        self.broker.cancel_all();
        let (progress_flushed, diagnostic_log_flushed) = match self.agent.as_ref() {
            Some(agent) => (
                agent.flush_progress().await.is_ok(),
                agent.flush_agent_event_log().await.is_ok(),
            ),
            None => (false, false),
        };
        let report = ShutdownReport {
            cancelled_turn,
            progress_flushed,
            diagnostic_log_flushed,
        };
        self.update_state(DesktopRunState::Stopped);
        let _ = self.buffer.publish(
            &self.session_id,
            DesktopEvent::Stopped {
                report: report.clone(),
            },
        );
        self.buffer.close();
        Ok(report)
    }

    fn update_state(&mut self, state: DesktopRunState) {
        self.state = state.clone();
        *self
            .shared_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = state;
    }
}
