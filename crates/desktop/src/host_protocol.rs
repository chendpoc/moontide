//! Host-side adapter for the independent Desktop wire protocol.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use desktop_protocol as wire;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::{
    DesktopCommandError, DesktopConfig, DesktopEventStream, DesktopHost, DesktopHostHandle,
    SessionSelection,
};

mod adapter;
#[cfg(test)]
mod tests;

const PROTOCOL_COMMAND_CAPACITY: usize = 32;
const EVENT_FORWARDER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
static NEXT_CONNECTION_EPOCH: AtomicU64 = AtomicU64::new(1);

pub struct DesktopProtocolConfig {
    pub agent: agent::AgentConfig,
    pub event_capacity: usize,
}

pub struct DesktopProtocolServer;

#[derive(Clone)]
pub struct DesktopProtocolServerHandle {
    sender: mpsc::Sender<ProtocolRequest>,
}

pub struct DesktopProtocolEventStream {
    receiver: mpsc::Receiver<wire::DesktopMessageEnvelope>,
}

impl DesktopProtocolServer {
    pub fn start(
        config: DesktopProtocolConfig,
    ) -> Result<(DesktopProtocolServerHandle, DesktopProtocolEventStream)> {
        if config.event_capacity < crate::host::MIN_EVENT_CAPACITY {
            bail!(
                "event_capacity must be at least {}",
                crate::host::MIN_EVENT_CAPACITY
            );
        }
        let runtime = tokio::runtime::Handle::try_current()
            .context("Desktop protocol server requires a Tokio runtime")?;
        let (sender, receiver) = mpsc::channel(PROTOCOL_COMMAND_CAPACITY);
        let (event_sender, event_receiver) = mpsc::channel(config.event_capacity);
        runtime.spawn(
            ProtocolServerActor {
                agent: Some(config.agent),
                event_capacity: config.event_capacity,
                connection_epoch: None,
                lifecycle: ProtocolLifecycle::Unhandshaken,
                receiver,
                event_sender: Some(event_sender),
                host: None,
                event_forwarder: None,
            }
            .run(),
        );

        Ok((
            DesktopProtocolServerHandle { sender },
            DesktopProtocolEventStream {
                receiver: event_receiver,
            },
        ))
    }
}

impl DesktopProtocolServerHandle {
    pub async fn request(
        &self,
        envelope: wire::DesktopMessageEnvelope,
    ) -> Result<wire::DesktopMessageEnvelope> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ProtocolRequest { envelope, reply })
            .await
            .context("Desktop protocol server request channel is closed")?;
        response
            .await
            .context("Desktop protocol server response channel is closed")?
    }
}

impl DesktopProtocolEventStream {
    pub async fn recv(&mut self) -> Option<wire::DesktopMessageEnvelope> {
        self.receiver.recv().await
    }
}

struct ProtocolRequest {
    envelope: wire::DesktopMessageEnvelope,
    reply: oneshot::Sender<Result<wire::DesktopMessageEnvelope>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProtocolLifecycle {
    Unhandshaken,
    Ready,
    Running,
    Stopped,
}

struct ProtocolServerActor {
    agent: Option<agent::AgentConfig>,
    event_capacity: usize,
    connection_epoch: Option<wire::ConnectionEpoch>,
    lifecycle: ProtocolLifecycle,
    receiver: mpsc::Receiver<ProtocolRequest>,
    event_sender: Option<mpsc::Sender<wire::DesktopMessageEnvelope>>,
    host: Option<DesktopHostHandle>,
    event_forwarder: Option<JoinHandle<Result<()>>>,
}

struct RequestOutcome {
    result: Result<wire::DesktopMessageEnvelope>,
    stop: bool,
}

impl RequestOutcome {
    fn keep_running(result: Result<wire::DesktopMessageEnvelope>) -> Self {
        Self {
            result,
            stop: false,
        }
    }

    fn stop(result: Result<wire::DesktopMessageEnvelope>) -> Self {
        Self { result, stop: true }
    }
}

struct ValidatedCommand {
    protocol_version: wire::ProtocolVersion,
    connection_epoch: Option<wire::ConnectionEpoch>,
    request_id: wire::RequestId,
    command: wire::DesktopCommand,
}

impl ProtocolServerActor {
    async fn run(mut self) {
        while let Some(request) = self.receiver.recv().await {
            let outcome = self.handle_request(request.envelope).await;
            let stop = outcome.stop;
            let _ = request.reply.send(outcome.result);
            if stop {
                break;
            }
        }
        self.cleanup().await;
    }

    async fn handle_request(&mut self, envelope: wire::DesktopMessageEnvelope) -> RequestOutcome {
        let validated = match validate_command_envelope(envelope) {
            Ok(command) => command,
            Err(error) => return RequestOutcome::stop(Err(error)),
        };

        if validated.protocol_version != wire::DESKTOP_PROTOCOL_VERSION {
            return RequestOutcome::keep_running(Ok(response_envelope(
                validated.request_id,
                self.response_epoch(),
                wire::DesktopResponse::Rejected {
                    error: adapter::command_error_to_wire(
                        &DesktopCommandError::ProtocolVersionUnsupported,
                    ),
                },
            )));
        }

        if matches!(&validated.command, wire::DesktopCommand::Handshake) {
            if self.lifecycle == ProtocolLifecycle::Unhandshaken {
                let connection_epoch = match next_connection_epoch() {
                    Ok(connection_epoch) => connection_epoch,
                    Err(error) => return RequestOutcome::stop(Err(error)),
                };
                self.connection_epoch = Some(connection_epoch);
                self.lifecycle = ProtocolLifecycle::Ready;
            }
            let Some(connection_epoch) = self.connection_epoch else {
                return RequestOutcome::stop(Err(anyhow::anyhow!(
                    "Desktop handshake did not establish a connection epoch"
                )));
            };
            return RequestOutcome::keep_running(Ok(response_envelope(
                validated.request_id,
                Some(connection_epoch),
                wire::DesktopResponse::HandshakeAccepted {
                    protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
                },
            )));
        }

        if self.lifecycle == ProtocolLifecycle::Unhandshaken {
            return RequestOutcome::keep_running(Ok(
                self.rejected(validated.request_id, DesktopCommandError::HandshakeRequired)
            ));
        }

        let Some(connection_epoch) = self.connection_epoch else {
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop protocol connection epoch is unavailable after handshake"
            )));
        };
        if validated.connection_epoch != Some(connection_epoch) {
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop command connection_epoch does not match the active connection"
            )));
        }

        if self.lifecycle == ProtocolLifecycle::Running
            && self
                .event_forwarder
                .as_ref()
                .is_some_and(JoinHandle::is_finished)
        {
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop protocol event stream closed unexpectedly"
            )));
        }

        let request_id = validated.request_id;
        match validated.command {
            wire::DesktopCommand::Handshake => RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop handshake reached domain routing unexpectedly"
            ))),
            wire::DesktopCommand::StartSession { selection } => {
                self.start_session(request_id, connection_epoch, selection)
                    .await
            }
            _ if self.lifecycle == ProtocolLifecycle::Ready => RequestOutcome::keep_running(Ok(
                self.rejected(request_id, DesktopCommandError::SessionNotStarted),
            )),
            wire::DesktopCommand::SubmitTurn { text } => {
                let Some(host) = self.host.as_ref() else {
                    return RequestOutcome::stop(Err(anyhow::anyhow!(
                        "Desktop protocol server lost its Host owner"
                    )));
                };
                let response = host
                    .submit_turn(text)
                    .await
                    .map(|turn| wire::DesktopResponse::TurnAccepted { turn });
                RequestOutcome::keep_running(Ok(self.domain_response(
                    request_id,
                    connection_epoch,
                    response,
                )))
            }
            wire::DesktopCommand::CancelTurn => {
                let Some(host) = self.host.as_ref() else {
                    return RequestOutcome::stop(Err(anyhow::anyhow!(
                        "Desktop protocol server lost its Host owner"
                    )));
                };
                let response = host
                    .cancel_turn_with_identity()
                    .await
                    .map(|turn| wire::DesktopResponse::CancellationAccepted { turn });
                RequestOutcome::keep_running(Ok(self.domain_response(
                    request_id,
                    connection_epoch,
                    response,
                )))
            }
            wire::DesktopCommand::Approve { approval_id } => {
                let Some(host) = self.host.as_ref() else {
                    return RequestOutcome::stop(Err(anyhow::anyhow!(
                        "Desktop protocol server lost its Host owner"
                    )));
                };
                let response = host
                    .approve(approval_id.clone())
                    .await
                    .map(|()| wire::DesktopResponse::ApprovalAccepted { approval_id });
                RequestOutcome::keep_running(Ok(self.domain_response(
                    request_id,
                    connection_epoch,
                    response,
                )))
            }
            wire::DesktopCommand::Deny {
                approval_id,
                reason,
            } => {
                let Some(host) = self.host.as_ref() else {
                    return RequestOutcome::stop(Err(anyhow::anyhow!(
                        "Desktop protocol server lost its Host owner"
                    )));
                };
                let response = host
                    .deny(approval_id.clone(), reason)
                    .await
                    .map(|()| wire::DesktopResponse::ApprovalAccepted { approval_id });
                RequestOutcome::keep_running(Ok(self.domain_response(
                    request_id,
                    connection_epoch,
                    response,
                )))
            }
            wire::DesktopCommand::Snapshot => {
                let Some(host) = self.host.as_ref() else {
                    return RequestOutcome::stop(Err(anyhow::anyhow!(
                        "Desktop protocol server lost its Host owner"
                    )));
                };
                let response =
                    host.snapshot()
                        .await
                        .map(|snapshot| wire::DesktopResponse::Snapshot {
                            snapshot: adapter::snapshot_to_wire(&snapshot),
                        });
                RequestOutcome::keep_running(Ok(self.domain_response(
                    request_id,
                    connection_epoch,
                    response,
                )))
            }
            wire::DesktopCommand::Shutdown => self.shutdown(request_id, connection_epoch).await,
        }
    }

    async fn start_session(
        &mut self,
        request_id: wire::RequestId,
        connection_epoch: wire::ConnectionEpoch,
        selection: wire::SessionSelectionDto,
    ) -> RequestOutcome {
        if self.lifecycle == ProtocolLifecycle::Running {
            return RequestOutcome::keep_running(Ok(
                self.rejected(request_id, DesktopCommandError::SessionAlreadyStarted)
            ));
        }
        if self.lifecycle != ProtocolLifecycle::Ready {
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop protocol server is not ready to start a Session"
            )));
        }

        let selection = match selection {
            wire::SessionSelectionDto::New => SessionSelection::New,
            wire::SessionSelectionDto::Existing { session_id } if !session_id.trim().is_empty() => {
                SessionSelection::Existing(session_id)
            }
            wire::SessionSelectionDto::Existing { .. } => {
                return RequestOutcome::keep_running(Ok(self.rejected(
                    request_id,
                    DesktopCommandError::InvalidInput(
                        "existing session_id must not be empty".into(),
                    ),
                )));
            }
        };
        let Some(agent) = self.agent.take() else {
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop protocol server boot config is unavailable"
            )));
        };
        let (host, event_stream) = match DesktopHost::start(DesktopConfig {
            agent,
            session: selection,
            event_capacity: self.event_capacity,
        })
        .await
        {
            Ok(host) => host,
            Err(error) => {
                return RequestOutcome::stop(Ok(
                    self.rejected(request_id, DesktopCommandError::Internal(error.to_string()))
                ));
            }
        };

        let snapshot = match host.snapshot().await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let _ = host.shutdown().await;
                return RequestOutcome::stop(Ok(self.rejected(request_id, error)));
            }
        };
        let Some(event_sender) = self.event_sender.take() else {
            let _ = host.shutdown().await;
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop protocol event channel is unavailable"
            )));
        };
        self.event_forwarder = Some(tokio::spawn(forward_events(
            event_stream,
            event_sender,
            connection_epoch,
        )));
        self.host = Some(host);
        self.lifecycle = ProtocolLifecycle::Running;

        RequestOutcome::keep_running(Ok(response_envelope(
            request_id,
            Some(connection_epoch),
            wire::DesktopResponse::SessionReady {
                snapshot: adapter::snapshot_to_wire(&snapshot),
            },
        )))
    }

    async fn shutdown(
        &mut self,
        request_id: wire::RequestId,
        connection_epoch: wire::ConnectionEpoch,
    ) -> RequestOutcome {
        let Some(host) = self.host.take() else {
            return RequestOutcome::stop(Err(anyhow::anyhow!(
                "Desktop protocol server lost its Host owner"
            )));
        };
        let report = match host.shutdown().await {
            Ok(report) => report,
            Err(error) => {
                self.abort_event_forwarder().await;
                self.lifecycle = ProtocolLifecycle::Stopped;
                return RequestOutcome::stop(Ok(self.rejected(request_id, error)));
            }
        };
        if let Err(error) = self.finish_event_forwarder().await {
            self.lifecycle = ProtocolLifecycle::Stopped;
            return RequestOutcome::stop(Err(error));
        }
        self.lifecycle = ProtocolLifecycle::Stopped;
        RequestOutcome::stop(Ok(response_envelope(
            request_id,
            Some(connection_epoch),
            wire::DesktopResponse::ShutdownCompleted {
                report: adapter::shutdown_to_wire(&report),
            },
        )))
    }

    fn domain_response(
        &self,
        request_id: wire::RequestId,
        connection_epoch: wire::ConnectionEpoch,
        response: std::result::Result<wire::DesktopResponse, DesktopCommandError>,
    ) -> wire::DesktopMessageEnvelope {
        let response = match response {
            Ok(response) => response,
            Err(error) => wire::DesktopResponse::Rejected {
                error: adapter::command_error_to_wire(&error),
            },
        };
        response_envelope(request_id, Some(connection_epoch), response)
    }

    fn rejected(
        &self,
        request_id: wire::RequestId,
        error: DesktopCommandError,
    ) -> wire::DesktopMessageEnvelope {
        response_envelope(
            request_id,
            self.response_epoch(),
            wire::DesktopResponse::Rejected {
                error: adapter::command_error_to_wire(&error),
            },
        )
    }

    fn response_epoch(&self) -> Option<wire::ConnectionEpoch> {
        self.connection_epoch
    }

    async fn finish_event_forwarder(&mut self) -> Result<()> {
        let forwarder = self
            .event_forwarder
            .take()
            .context("Desktop protocol event forwarder is unavailable")?;
        finish_event_forwarder(forwarder, EVENT_FORWARDER_SHUTDOWN_TIMEOUT).await
    }

    async fn abort_event_forwarder(&mut self) {
        if let Some(forwarder) = self.event_forwarder.take() {
            forwarder.abort();
            let _ = forwarder.await;
        }
    }

    async fn cleanup(&mut self) {
        self.lifecycle = ProtocolLifecycle::Stopped;
        drop(self.event_sender.take());
        if let Some(host) = self.host.take() {
            let _ = host.shutdown().await;
        }
        self.abort_event_forwarder().await;
    }
}

async fn forward_events(
    mut stream: DesktopEventStream,
    sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
    connection_epoch: wire::ConnectionEpoch,
) -> Result<()> {
    while let Some(event) = stream.recv().await {
        sender
            .send(adapter::event_envelope_to_wire(&event, connection_epoch))
            .await
            .context("Desktop protocol event receiver is closed")?;
    }
    Ok(())
}

async fn finish_event_forwarder(
    mut forwarder: JoinHandle<Result<()>>,
    shutdown_timeout: Duration,
) -> Result<()> {
    match timeout(shutdown_timeout, &mut forwarder).await {
        Ok(result) => result.context("Desktop protocol event forwarder task failed")?,
        Err(_) => {
            forwarder.abort();
            let _ = forwarder.await;
            bail!("Desktop protocol event forwarder did not drain within {shutdown_timeout:?}");
        }
    }
}

fn validate_command_envelope(envelope: wire::DesktopMessageEnvelope) -> Result<ValidatedCommand> {
    if envelope.seq.is_some() {
        bail!("Desktop command envelope must not contain seq");
    }
    let request_id = envelope
        .request_id
        .context("Desktop command envelope requires request_id")?;
    if request_id.0.trim().is_empty() {
        bail!("Desktop command request_id must not be empty");
    }
    let wire::DesktopMessage::Command { command } = envelope.payload else {
        bail!("Desktop protocol server accepts command payloads only");
    };
    match command {
        wire::DesktopCommand::Handshake if envelope.connection_epoch.is_some() => {
            bail!("Handshake command must not contain connection_epoch");
        }
        wire::DesktopCommand::Handshake => {}
        _ if envelope.connection_epoch.is_none() => {
            bail!("Desktop command requires connection_epoch after handshake");
        }
        _ => {}
    }

    Ok(ValidatedCommand {
        protocol_version: envelope.protocol_version,
        connection_epoch: envelope.connection_epoch,
        request_id,
        command,
    })
}

fn response_envelope(
    request_id: wire::RequestId,
    connection_epoch: Option<wire::ConnectionEpoch>,
    response: wire::DesktopResponse,
) -> wire::DesktopMessageEnvelope {
    wire::DesktopMessageEnvelope {
        protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
        connection_epoch,
        request_id: Some(request_id),
        seq: None,
        payload: wire::DesktopMessage::Response { response },
    }
}

fn next_connection_epoch() -> Result<wire::ConnectionEpoch> {
    NEXT_CONNECTION_EPOCH
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
            current.checked_add(1)
        })
        .map(wire::ConnectionEpoch)
        .map_err(|_| anyhow::anyhow!("Desktop connection epoch space is exhausted"))
}
