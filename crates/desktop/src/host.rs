use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::approval::ApprovalBroker;
use crate::command::{DesktopCommandError, HostCommand};
use crate::event::{DesktopEvent, DesktopEventStream, EventBuffer};
use crate::state::{
    DesktopError, DesktopErrorKind, DesktopRunState, DesktopSnapshot, ShutdownReport,
};

const COMMAND_CAPACITY: usize = 32;
const MIN_EVENT_CAPACITY: usize = 16;

pub struct DesktopConfig {
    pub agent: agent::AgentConfig,
    pub session: SessionSelection,
    pub event_capacity: usize,
}

pub enum SessionSelection {
    New,
    Existing(String),
}

pub struct DesktopHost;

pub struct DesktopHostHandle {
    sender: mpsc::Sender<HostCommand>,
}

struct ActiveTurn {
    turn: u64,
    cancellation: CancellationToken,
    join: JoinHandle<(agent::Agent, Result<agent::ModelResponse>)>,
}

struct HostActor {
    agent: Option<agent::Agent>,
    session_id: String,
    query: agent::SessionQuery,
    broker: Arc<ApprovalBroker>,
    buffer: Arc<EventBuffer>,
    shared_state: Arc<Mutex<DesktopRunState>>,
    receiver: mpsc::Receiver<HostCommand>,
    state: DesktopRunState,
    next_turn: u64,
    active: Option<ActiveTurn>,
}

struct ProgressSink {
    session_id: Arc<Mutex<String>>,
    shared_state: Arc<Mutex<DesktopRunState>>,
    buffer: Arc<EventBuffer>,
}

impl agent::ProgressObserver for ProgressSink {
    fn on_progress(&self, event: &agent::ProgressEvent) -> Result<()> {
        let session_id = self
            .session_id
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(state) = progress_state(event) {
            *self
                .shared_state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = state.clone();
            let _ = self
                .buffer
                .publish(&session_id, DesktopEvent::StateChanged { state });
        }
        let _ = self.buffer.publish(
            &session_id,
            DesktopEvent::Progress {
                event: event.clone(),
            },
        );
        Ok(())
    }
}

impl DesktopHost {
    pub async fn start(config: DesktopConfig) -> Result<(DesktopHostHandle, DesktopEventStream)> {
        if config.event_capacity < MIN_EVENT_CAPACITY {
            bail!("event_capacity must be at least {MIN_EVENT_CAPACITY}");
        }

        let query = agent::SessionQuery::new(config.agent.sessions_dir.clone());
        let next_turn = match &config.session {
            SessionSelection::New => 0,
            SessionSelection::Existing(session_id) => query
                .load(session_id)
                .with_context(|| format!("load session {session_id} for Desktop host"))?
                .summary
                .last_turn
                .map_or(0, |turn| turn.saturating_add(1)),
        };

        let buffer = EventBuffer::new(config.event_capacity);
        let shared_state = Arc::new(Mutex::new(DesktopRunState::Starting));
        let mut agent_config = config.agent;
        let session_id_hint = match &config.session {
            SessionSelection::New => String::new(),
            SessionSelection::Existing(session_id) => session_id.clone(),
        };
        let session_identity = Arc::new(Mutex::new(session_id_hint.clone()));
        let broker = Arc::new(ApprovalBroker::new(
            agent_config.cwd.clone(),
            session_id_hint,
            Arc::clone(&shared_state),
            Arc::clone(&buffer),
        ));
        agent_config.approval = Some(Arc::clone(&broker) as Arc<dyn agent::ToolApprovalHandler>);
        agent_config.progress = Some(Arc::new(ProgressSink {
            session_id: Arc::clone(&session_identity),
            shared_state: Arc::clone(&shared_state),
            buffer: Arc::clone(&buffer),
        }));

        let agent = match config.session {
            SessionSelection::New => agent::Agent::create(agent_config),
            SessionSelection::Existing(session_id) => {
                agent::Agent::resume(agent_config, &session_id)
            }
        }?;
        let session_id = agent.session_id().to_owned();
        *session_identity
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = session_id.clone();
        broker.set_session_id(session_id.clone());
        let _ = buffer.publish(
            &session_id,
            DesktopEvent::StateChanged {
                state: DesktopRunState::Idle,
            },
        );
        *shared_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = DesktopRunState::Idle;
        let (sender, receiver) = mpsc::channel(COMMAND_CAPACITY);
        let actor = HostActor {
            agent: Some(agent),
            session_id,
            query,
            broker,
            buffer: Arc::clone(&buffer),
            shared_state,
            receiver,
            state: DesktopRunState::Idle,
            next_turn,
            active: None,
        };
        tokio::spawn(actor.run());

        Ok((
            DesktopHostHandle { sender },
            DesktopEventStream::new(buffer),
        ))
    }
}

impl DesktopHostHandle {
    pub async fn submit_turn(&self, text: String) -> Result<u64, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::SubmitTurn { text, reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn cancel_turn(&self) -> Result<(), DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::CancelTurn { reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn approve(&self, request_id: String) -> Result<(), DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Approve { request_id, reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn deny(
        &self,
        request_id: String,
        reason: String,
    ) -> Result<(), DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Deny {
                request_id,
                reason,
                reply,
            })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn snapshot(&self) -> Result<DesktopSnapshot, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Snapshot { reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }

    pub async fn shutdown(self) -> Result<ShutdownReport, DesktopCommandError> {
        let (reply, result) = oneshot_reply();
        self.sender
            .send(HostCommand::Shutdown { reply })
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?;
        result
            .await
            .map_err(|_| DesktopCommandError::EventStreamClosed)?
    }
}

impl HostActor {
    async fn run(mut self) {
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
                        active.cancellation.cancel();
                        self.update_state(DesktopRunState::Cancelling { turn: active.turn });
                        let _ = self.buffer.publish(
                            &self.session_id,
                            DesktopEvent::StateChanged {
                                state: self.state.clone(),
                            },
                        );
                        Ok(())
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

    fn start_turn(&mut self, text: String) -> Result<u64, DesktopCommandError> {
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

    async fn finish_turn(
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
        if let Some(active) = self.active.take() {
            if let Ok((agent, _)) = active.join.await {
                self.agent = Some(agent);
            }
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

fn oneshot_reply<T>() -> (
    tokio::sync::oneshot::Sender<T>,
    tokio::sync::oneshot::Receiver<T>,
) {
    tokio::sync::oneshot::channel()
}

fn progress_state(event: &agent::ProgressEvent) -> Option<DesktopRunState> {
    match event {
        agent::ProgressEvent::TurnStarted { turn } => Some(DesktopRunState::Thinking {
            turn: *turn,
            step: 0,
        }),
        agent::ProgressEvent::LlmCallStarted { turn, step, .. } => {
            Some(DesktopRunState::Thinking {
                turn: *turn,
                step: *step,
            })
        }
        agent::ProgressEvent::ToolCall { turn, call } => Some(DesktopRunState::RunningTool {
            turn: *turn,
            tool_use_id: call.tool_use_id().to_owned(),
            name: call.name().to_owned(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use agent_core::{
        llm::{adapter::AdapterFamily, protocol::ThinkingLevel},
        r#loop::ToolPermissionMap,
    };
    use tempfile::TempDir;

    use super::*;

    fn config(root: &TempDir) -> agent::AgentConfig {
        agent::AgentConfig {
            cwd: root.path().to_path_buf(),
            sessions_dir: root.path().join("sessions"),
            runs_dir: root.path().join("runs"),
            provider: agent::ProviderConfig {
                family: AdapterFamily::OpenAiChatCompletions,
                base_url: "https://example.com/v1".into(),
                api_key: "test-key".into(),
            },
            model: "test-model".into(),
            max_tokens: 128,
            thinking_level: Some(ThinkingLevel::Off),
            max_steps: 4,
            tool_names: Vec::new(),
            permissions: ToolPermissionMap::new(),
            approval: None,
            progress: None,
            persistence: agent::PersistenceConfig::default(),
        }
    }

    // 场景：Host 启动后查询完整 session snapshot 并关闭。
    // 预期：create path 不创建第二 writer，shutdown 完成 flush 并关闭 event stream。
    #[tokio::test]
    async fn host_start_snapshot_and_shutdown() {
        let root = TempDir::new().expect("tempdir");
        let (handle, mut stream) = DesktopHost::start(DesktopConfig {
            agent: config(&root),
            session: SessionSelection::New,
            event_capacity: 16,
        })
        .await
        .expect("host should start");

        let snapshot = handle.snapshot().await.expect("snapshot should load");
        assert_eq!(snapshot.session.summary.item_count, 0);
        let report = handle.shutdown().await.expect("shutdown should complete");
        assert!(report.progress_flushed);
        assert!(report.diagnostic_log_flushed);
        while stream.recv().await.is_some() {}
    }

    // 场景：同一 Host 在第一个 Turn active 时再次提交文本。
    // 预期：第二次提交返回 typed Busy，不依赖错误字符串；不变量：同一 Session 只有一个 active Turn。
    #[tokio::test]
    async fn host_rejects_second_active_turn_with_typed_busy() {
        let root = TempDir::new().expect("tempdir");
        let agent = agent::Agent::create(config(&root)).expect("agent should start");
        let session_id = agent.session_id().to_owned();
        let buffer = EventBuffer::new(16);
        let shared_state = Arc::new(Mutex::new(DesktopRunState::Idle));
        let broker = Arc::new(ApprovalBroker::new(
            root.path().to_path_buf(),
            session_id.clone(),
            Arc::clone(&shared_state),
            Arc::clone(&buffer),
        ));
        let query = agent::SessionQuery::new(root.path().join("sessions"));
        let (_sender, receiver) = mpsc::channel(1);
        let mut actor = HostActor {
            agent: Some(agent),
            session_id,
            query,
            broker,
            buffer,
            shared_state,
            receiver,
            state: DesktopRunState::Idle,
            next_turn: 0,
            active: None,
        };

        assert_eq!(actor.start_turn("first".into()), Ok(0));
        assert_eq!(
            actor.start_turn("second".into()),
            Err(DesktopCommandError::Busy)
        );
        let active = actor.active.take().expect("active turn");
        active.cancellation.cancel();
        let turn = active.turn;
        let cancellation = active.cancellation;
        let result = active.join.await.expect("turn task should return");
        actor.finish_turn(turn, cancellation, Ok(result)).await;
    }
}
