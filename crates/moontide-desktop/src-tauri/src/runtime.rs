//! Integrated Desktop runtime: Host lifecycle, connection epoch, and event adaptation.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent::AgentConfig;
use anyhow::{bail, Context, Result};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::protocol as wire;

pub(crate) mod adapter;
pub(crate) mod approval;
mod catalog;
pub(crate) mod command;
mod coordinator;
pub(crate) mod event;
pub(crate) mod host;
pub(crate) mod state;

use self::adapter as runtime_wire;
use self::event::DesktopEventStream;
use self::host::{
    DesktopConfig, DesktopHost, DesktopHostHandle, SessionSelection, MIN_EVENT_CAPACITY,
};

pub(crate) use command::DesktopCommandError;
pub(crate) use coordinator::{DesktopRuntimeCoordinator, DesktopRuntimeCoordinatorHandle};

const EVENT_FORWARDER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
static NEXT_CONNECTION_EPOCH: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeLifecycle {
    Ready,
    Starting,
    Running,
    Stopped,
}

pub(crate) struct DesktopRuntime {
    pub(crate) handle: DesktopRuntimeHandle,
    pub(crate) events: DesktopRuntimeEventStream,
}

pub(crate) struct DesktopRuntimeEventStream {
    receiver: mpsc::Receiver<wire::DesktopMessageEnvelope>,
}

impl DesktopRuntimeEventStream {
    pub(crate) async fn recv(&mut self) -> Option<wire::DesktopMessageEnvelope> {
        self.receiver.recv().await
    }
}

#[derive(Clone)]
pub(crate) struct DesktopRuntimeHandle {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    agent_config: Mutex<Option<AgentConfig>>,
    sessions_dir: std::path::PathBuf,
    connection_epoch: wire::ConnectionEpoch,
    lifecycle: Mutex<RuntimeLifecycle>,
    loaded_session_id: Mutex<Option<String>>,
    host: Mutex<Option<DesktopHostHandle>>,
    event_forwarder: Mutex<Option<JoinHandle<Result<()>>>>,
    event_sender: Mutex<Option<mpsc::Sender<wire::DesktopMessageEnvelope>>>,
    event_capacity: usize,
}

impl DesktopRuntime {
    pub(crate) fn start(agent_config: AgentConfig, event_capacity: usize) -> Result<Self> {
        if event_capacity < MIN_EVENT_CAPACITY {
            bail!("event_capacity must be at least {MIN_EVENT_CAPACITY}");
        }
        let connection_epoch = next_connection_epoch()?;
        let (event_sender, event_receiver) = mpsc::channel(event_capacity);
        let sessions_dir = agent_config.sessions_dir.clone();
        let inner = Arc::new(RuntimeInner {
            agent_config: Mutex::new(Some(agent_config)),
            sessions_dir,
            connection_epoch,
            lifecycle: Mutex::new(RuntimeLifecycle::Ready),
            loaded_session_id: Mutex::new(None),
            host: Mutex::new(None),
            event_forwarder: Mutex::new(None),
            event_sender: Mutex::new(Some(event_sender)),
            event_capacity,
        });
        Ok(Self {
            handle: DesktopRuntimeHandle { inner },
            events: DesktopRuntimeEventStream {
                receiver: event_receiver,
            },
        })
    }
}

impl DesktopRuntimeHandle {
    pub(crate) fn connection_epoch(&self) -> wire::ConnectionEpoch {
        self.inner.connection_epoch
    }

    pub(crate) fn list_sessions(&self) -> wire::DesktopResponse {
        let loaded_session_id = self
            .inner
            .loaded_session_id
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        match catalog::list_rows(
            self.inner.sessions_dir.clone(),
            loaded_session_id.as_deref(),
        ) {
            Ok(rows) => wire::DesktopResponse::SessionCatalogListed {
                connection_epoch: self.inner.connection_epoch,
                rows,
            },
            Err(error) => wire::DesktopResponse::Rejected {
                error: runtime_wire::command_error_to_wire(
                    &DesktopCommandError::CatalogUnavailable(error.to_string()),
                ),
            },
        }
    }

    pub(crate) async fn create_session(
        &self,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        self.start_session(SessionSelection::New).await
    }

    pub(crate) async fn load_session(
        &self,
        session_id: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        if session_id.trim().is_empty() {
            return Ok(wire::DesktopResponse::Rejected {
                error: runtime_wire::command_error_to_wire(&DesktopCommandError::InvalidInput(
                    "existing session_id must not be empty".into(),
                )),
            });
        }
        self.start_session(SessionSelection::Existing(session_id))
            .await
    }

    async fn start_session(
        &self,
        session: SessionSelection,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        {
            let lifecycle = self
                .inner
                .lifecycle
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if *lifecycle == RuntimeLifecycle::Running {
                return Ok(wire::DesktopResponse::Rejected {
                    error: runtime_wire::command_error_to_wire(
                        &DesktopCommandError::SessionAlreadyStarted,
                    ),
                });
            }
            if *lifecycle != RuntimeLifecycle::Ready {
                return Err(DesktopCommandError::Stopped);
            }
        }

        let agent = self
            .inner
            .agent_config
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
            .ok_or(DesktopCommandError::Internal(
                "Desktop runtime boot config is unavailable".into(),
            ))?;

        *self
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = RuntimeLifecycle::Starting;

        let (host, event_stream) = match DesktopHost::start(DesktopConfig {
            agent,
            session,
            event_capacity: self.inner.event_capacity,
        })
        .await
        {
            Ok(started) => started,
            Err(error) => {
                self.stop_unstarted();
                return Ok(wire::DesktopResponse::Rejected {
                    error: runtime_wire::command_error_to_wire(
                        &DesktopCommandError::SessionStartFailed(error.to_string()),
                    ),
                });
            }
        };

        let snapshot = match host.snapshot().await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let _ = host.shutdown().await;
                self.stop_unstarted();
                return Ok(wire::DesktopResponse::Rejected {
                    error: runtime_wire::command_error_to_wire(
                        &DesktopCommandError::SessionStartFailed(error.to_string()),
                    ),
                });
            }
        };

        let event_sender = self
            .inner
            .event_sender
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
            .ok_or(DesktopCommandError::EventStreamClosed)?;

        let forwarder = tokio::spawn(forward_events(
            event_stream,
            event_sender,
            self.inner.connection_epoch,
        ));
        *self
            .inner
            .event_forwarder
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(forwarder);
        *self
            .inner
            .host
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(host);
        *self
            .inner
            .loaded_session_id
            .lock()
            .unwrap_or_else(|error| error.into_inner()) =
            Some(snapshot.session.summary.session_id.clone());
        *self
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = RuntimeLifecycle::Running;

        Ok(wire::DesktopResponse::SessionReady {
            connection_epoch: self.inner.connection_epoch,
            snapshot: runtime_wire::snapshot_to_wire(&snapshot),
        })
    }

    pub(crate) async fn submit_turn(
        &self,
        session_id: String,
        text: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let loaded_session_id = self
            .inner
            .loaded_session_id
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
            .ok_or(DesktopCommandError::SessionNotStarted)?;
        if loaded_session_id != session_id {
            return Ok(map_domain_response(Err(
                DesktopCommandError::SessionMismatch {
                    requested: session_id,
                    loaded: loaded_session_id,
                },
            )));
        }
        let host = self.require_host().await?;
        let response = host
            .submit_turn(text)
            .await
            .map(|turn| wire::DesktopResponse::TurnAccepted { turn });
        Ok(map_domain_response(response))
    }

    pub(crate) async fn cancel_turn(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let host = self.require_host().await?;
        let response = host
            .cancel_turn_with_identity()
            .await
            .map(|turn| wire::DesktopResponse::CancellationAccepted { turn });
        Ok(map_domain_response(response))
    }

    pub(crate) async fn approve(
        &self,
        approval_id: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let host = self.require_host().await?;
        let response = host
            .approve(approval_id.clone())
            .await
            .map(|()| wire::DesktopResponse::ApprovalAccepted { approval_id });
        Ok(map_domain_response(response))
    }

    pub(crate) async fn deny(
        &self,
        approval_id: String,
        reason: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let host = self.require_host().await?;
        let response = host
            .deny(approval_id.clone(), reason)
            .await
            .map(|()| wire::DesktopResponse::ApprovalAccepted { approval_id });
        Ok(map_domain_response(response))
    }

    pub(crate) async fn snapshot(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let host = self.require_host().await?;
        let response = host
            .snapshot()
            .await
            .map(|snapshot| wire::DesktopResponse::Snapshot {
                connection_epoch: self.inner.connection_epoch,
                snapshot: runtime_wire::snapshot_to_wire(&snapshot),
            });
        Ok(map_domain_response(response))
    }

    pub(crate) async fn shutdown(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let lifecycle = *self
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match lifecycle {
            RuntimeLifecycle::Ready => {
                self.stop_unstarted();
                return Ok(wire::DesktopResponse::ShutdownCompleted {
                    report: wire::ShutdownReportDto {
                        cancelled_turn: None,
                        progress_flushed: true,
                        diagnostic_log_flushed: true,
                    },
                });
            }
            RuntimeLifecycle::Starting => return Err(DesktopCommandError::Stopping),
            RuntimeLifecycle::Stopped => return Err(DesktopCommandError::Stopped),
            RuntimeLifecycle::Running => {}
        }
        let host = self
            .inner
            .host
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
            .ok_or(DesktopCommandError::SessionNotStarted)?;

        let report = match host.shutdown().await {
            Ok(report) => report,
            Err(error) => {
                self.abort_event_forwarder().await;
                *self
                    .inner
                    .lifecycle
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = RuntimeLifecycle::Stopped;
                return Ok(wire::DesktopResponse::Rejected {
                    error: runtime_wire::command_error_to_wire(&error),
                });
            }
        };

        if let Err(error) = self.finish_event_forwarder().await {
            *self
                .inner
                .lifecycle
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = RuntimeLifecycle::Stopped;
            return Err(DesktopCommandError::Internal(error.to_string()));
        }

        *self
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = RuntimeLifecycle::Stopped;
        Ok(wire::DesktopResponse::ShutdownCompleted {
            report: runtime_wire::shutdown_to_wire(&report),
        })
    }

    async fn require_host(&self) -> Result<DesktopHostHandle, DesktopCommandError> {
        let lifecycle = *self
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match lifecycle {
            RuntimeLifecycle::Ready | RuntimeLifecycle::Starting => {
                Err(DesktopCommandError::SessionNotStarted)
            }
            RuntimeLifecycle::Stopped => Err(DesktopCommandError::Stopped),
            RuntimeLifecycle::Running => self
                .inner
                .host
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
                .ok_or(DesktopCommandError::EventStreamClosed),
        }
    }

    async fn finish_event_forwarder(&self) -> Result<()> {
        let forwarder = self
            .inner
            .event_forwarder
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
            .context("Desktop runtime event forwarder is unavailable")?;
        match timeout(EVENT_FORWARDER_SHUTDOWN_TIMEOUT, forwarder).await {
            Ok(result) => result.context("Desktop runtime event forwarder task failed")?,
            Err(_) => bail!("Desktop runtime event forwarder did not drain within {EVENT_FORWARDER_SHUTDOWN_TIMEOUT:?}"),
        }
    }

    async fn abort_event_forwarder(&self) {
        let forwarder = self
            .inner
            .event_forwarder
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        if let Some(forwarder) = forwarder {
            forwarder.abort();
            let _ = forwarder.await;
        }
    }

    fn stop_unstarted(&self) {
        self.inner
            .event_sender
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        *self
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = RuntimeLifecycle::Stopped;
    }
}

fn map_domain_response(
    response: Result<wire::DesktopResponse, DesktopCommandError>,
) -> wire::DesktopResponse {
    match response {
        Ok(response) => response,
        Err(error) => wire::DesktopResponse::Rejected {
            error: runtime_wire::command_error_to_wire(&error),
        },
    }
}

async fn forward_events(
    mut stream: DesktopEventStream,
    sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
    connection_epoch: wire::ConnectionEpoch,
) -> Result<()> {
    while let Some(event) = stream.recv().await {
        sender
            .send(runtime_wire::event_envelope_to_wire(
                &event,
                connection_epoch,
            ))
            .await
            .context("Desktop runtime event receiver is closed")?;
    }
    Ok(())
}

fn next_connection_epoch() -> Result<wire::ConnectionEpoch> {
    NEXT_CONNECTION_EPOCH
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current.checked_add(1)
        })
        .map(wire::ConnectionEpoch)
        .map_err(|_| anyhow::anyhow!("Desktop connection epoch space is exhausted"))
}
