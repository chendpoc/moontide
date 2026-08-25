use std::collections::HashMap;

use anyhow::{anyhow, bail, Result};
use desktop_protocol as wire;
use tokio::sync::{mpsc, oneshot};

use crate::transport::ClientTransport;

#[cfg(test)]
mod tests;

const CLIENT_COMMAND_CAPACITY: usize = 64;
const MAX_PENDING_REQUESTS: usize = 64;

#[derive(Clone)]
pub(crate) struct DesktopProtocolClient {
    sender: mpsc::Sender<ClientCommand>,
}

pub(crate) struct DesktopProtocolClientEventStream {
    event_receiver: mpsc::Receiver<Box<wire::DesktopMessageEnvelope>>,
    connection_receiver: mpsc::Receiver<ConnectionClosed>,
    event_open: bool,
    connection_open: bool,
}

#[derive(Debug)]
pub(crate) enum DesktopProtocolClientEvent {
    Envelope(Box<wire::DesktopMessageEnvelope>),
    Disconnected { graceful: bool, reason: String },
}

struct ConnectionClosed {
    graceful: bool,
    reason: String,
}

impl DesktopProtocolClient {
    pub(crate) fn start(
        transport: ClientTransport,
        event_capacity: usize,
    ) -> Result<(Self, DesktopProtocolClientEventStream)> {
        tokio::runtime::Handle::try_current()
            .map_err(|_| anyhow!("Desktop protocol client requires an active Tokio runtime"))?;
        if event_capacity == 0 {
            bail!("Desktop protocol client event capacity must be greater than zero");
        }

        let (command_sender, command_receiver) = mpsc::channel(CLIENT_COMMAND_CAPACITY);
        let (event_sender, event_receiver) = mpsc::channel(event_capacity);
        let (connection_sender, connection_receiver) = mpsc::channel(1);
        tokio::spawn(
            ClientActor {
                command_receiver,
                transport_sender: transport.sender,
                transport_receiver: transport.receiver,
                event_sender,
                connection_sender,
                connection_epoch: None,
                next_request_id: 1,
                pending: HashMap::new(),
                shutdown_requested: false,
                graceful_shutdown: false,
            }
            .run(),
        );

        Ok((
            Self {
                sender: command_sender,
            },
            DesktopProtocolClientEventStream {
                event_receiver,
                connection_receiver,
                event_open: true,
                connection_open: true,
            },
        ))
    }

    pub(crate) async fn request(
        &self,
        command: wire::DesktopCommand,
    ) -> Result<wire::DesktopMessageEnvelope> {
        let (reply_sender, reply_receiver) = oneshot::channel();
        self.sender
            .send(ClientCommand {
                command,
                reply: reply_sender,
            })
            .await
            .map_err(|_| anyhow!("Desktop protocol client connection is closed"))?;
        reply_receiver
            .await
            .map_err(|_| anyhow!("Desktop protocol client connection closed before response"))?
    }
}

impl DesktopProtocolClientEventStream {
    pub(crate) async fn recv(&mut self) -> Option<DesktopProtocolClientEvent> {
        loop {
            if !self.event_open && !self.connection_open {
                return None;
            }
            tokio::select! {
                biased;
                event = self.event_receiver.recv(), if self.event_open => {
                    match event {
                        Some(envelope) => {
                            return Some(DesktopProtocolClientEvent::Envelope(envelope));
                        }
                        None => self.event_open = false,
                    }
                }
                connection = self.connection_receiver.recv(), if self.connection_open => {
                    match connection {
                        Some(closed) => {
                            return Some(DesktopProtocolClientEvent::Disconnected {
                                graceful: closed.graceful,
                                reason: closed.reason,
                            });
                        }
                        None => self.connection_open = false,
                    }
                }
            }
        }
    }
}

struct ClientCommand {
    command: wire::DesktopCommand,
    reply: oneshot::Sender<Result<wire::DesktopMessageEnvelope>>,
}

struct PendingRequest {
    expected: ExpectedResponse,
    reply: oneshot::Sender<Result<wire::DesktopMessageEnvelope>>,
}

#[derive(Clone, Copy)]
enum ExpectedResponse {
    Handshake,
    StartSession,
    SubmitTurn,
    CancelTurn,
    Approval,
    Snapshot,
    Shutdown,
}

impl ExpectedResponse {
    fn for_command(command: &wire::DesktopCommand) -> Self {
        match command {
            wire::DesktopCommand::Handshake => Self::Handshake,
            wire::DesktopCommand::StartSession { .. } => Self::StartSession,
            wire::DesktopCommand::SubmitTurn { .. } => Self::SubmitTurn,
            wire::DesktopCommand::CancelTurn => Self::CancelTurn,
            wire::DesktopCommand::Approve { .. } | wire::DesktopCommand::Deny { .. } => {
                Self::Approval
            }
            wire::DesktopCommand::Snapshot => Self::Snapshot,
            wire::DesktopCommand::Shutdown => Self::Shutdown,
        }
    }

    fn accepts(self, response: &wire::DesktopResponse) -> bool {
        matches!(response, wire::DesktopResponse::Rejected { .. })
            || matches!(
                (self, response),
                (
                    Self::Handshake,
                    wire::DesktopResponse::HandshakeAccepted { .. }
                ) | (
                    Self::StartSession,
                    wire::DesktopResponse::SessionReady { .. }
                ) | (Self::SubmitTurn, wire::DesktopResponse::TurnAccepted { .. })
                    | (
                        Self::CancelTurn,
                        wire::DesktopResponse::CancellationAccepted { .. }
                    )
                    | (
                        Self::Approval,
                        wire::DesktopResponse::ApprovalAccepted { .. }
                    )
                    | (Self::Snapshot, wire::DesktopResponse::Snapshot { .. })
                    | (
                        Self::Shutdown,
                        wire::DesktopResponse::ShutdownCompleted { .. }
                    )
            )
    }
}

struct ClientActor {
    command_receiver: mpsc::Receiver<ClientCommand>,
    transport_sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
    transport_receiver:
        mpsc::Receiver<Result<wire::DesktopMessageEnvelope, crate::transport::TransportFailure>>,
    event_sender: mpsc::Sender<Box<wire::DesktopMessageEnvelope>>,
    connection_sender: mpsc::Sender<ConnectionClosed>,
    connection_epoch: Option<wire::ConnectionEpoch>,
    next_request_id: u64,
    pending: HashMap<wire::RequestId, PendingRequest>,
    shutdown_requested: bool,
    graceful_shutdown: bool,
}

impl ClientActor {
    async fn run(mut self) {
        loop {
            tokio::select! {
                incoming = self.transport_receiver.recv() => {
                    match incoming {
                        Some(Ok(envelope)) => {
                            if let Err(error) = self.handle_incoming(envelope) {
                                self.fail_connection(error.to_string());
                                break;
                            }
                        }
                        Some(Err(error)) => {
                            self.fail_connection(error.to_string());
                            break;
                        }
                        None => {
                            let reason = if self.graceful_shutdown {
                                "Desktop protocol transport closed after shutdown"
                            } else {
                                "Desktop protocol transport closed unexpectedly"
                            };
                            self.fail_connection(reason.into());
                            break;
                        }
                    }
                }
                command = self.command_receiver.recv() => {
                    let Some(command) = command else {
                        break;
                    };
                    if let Err(error) = self.dispatch(command) {
                        self.fail_connection(error.to_string());
                        break;
                    }
                }
            }
        }
    }

    fn dispatch(&mut self, command: ClientCommand) -> Result<()> {
        if self.shutdown_requested {
            let _ = command.reply.send(Err(anyhow!(
                "Desktop protocol shutdown is already in progress"
            )));
            return Ok(());
        }
        if self.pending.len() >= MAX_PENDING_REQUESTS {
            let _ = command.reply.send(Err(anyhow!(
                "Desktop protocol pending request limit was reached"
            )));
            return Ok(());
        }

        let connection_epoch = match &command.command {
            wire::DesktopCommand::Handshake => None,
            _ => match self.connection_epoch {
                Some(epoch) => Some(epoch),
                None => {
                    let _ = command
                        .reply
                        .send(Err(anyhow!("Desktop protocol handshake has not completed")));
                    return Ok(());
                }
            },
        };
        let request_id = wire::RequestId(format!("request-{}", self.next_request_id));
        self.next_request_id = self
            .next_request_id
            .checked_add(1)
            .ok_or_else(|| anyhow!("Desktop protocol request ID space exhausted"))?;
        let expected = ExpectedResponse::for_command(&command.command);
        let is_shutdown = matches!(command.command, wire::DesktopCommand::Shutdown);
        let envelope = wire::DesktopMessageEnvelope {
            protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
            connection_epoch,
            request_id: Some(request_id.clone()),
            seq: None,
            payload: wire::DesktopMessage::Command {
                command: command.command,
            },
        };

        match self.transport_sender.try_send(envelope) {
            Ok(()) => {
                self.pending.insert(
                    request_id,
                    PendingRequest {
                        expected,
                        reply: command.reply,
                    },
                );
                if is_shutdown {
                    self.shutdown_requested = true;
                }
                Ok(())
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                let _ = command
                    .reply
                    .send(Err(anyhow!("Desktop protocol transport queue is full")));
                Ok(())
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                let _ = command
                    .reply
                    .send(Err(anyhow!("Desktop protocol transport is closed")));
                bail!("Desktop protocol transport is closed")
            }
        }
    }

    fn handle_incoming(&mut self, envelope: wire::DesktopMessageEnvelope) -> Result<()> {
        if envelope.protocol_version != wire::DESKTOP_PROTOCOL_VERSION {
            bail!("Desktop protocol transport delivered an unsupported version");
        }

        match &envelope.payload {
            wire::DesktopMessage::Response { response } => {
                self.handle_response(envelope.clone(), response)
            }
            wire::DesktopMessage::Event { .. } => self.handle_event(envelope),
            wire::DesktopMessage::Command { .. } => {
                bail!("Desktop protocol transport delivered a command to the client")
            }
        }
    }

    fn handle_response(
        &mut self,
        envelope: wire::DesktopMessageEnvelope,
        response: &wire::DesktopResponse,
    ) -> Result<()> {
        if envelope.seq.is_some() {
            bail!("Desktop protocol response carried an event sequence");
        }
        let request_id = envelope
            .request_id
            .clone()
            .ok_or_else(|| anyhow!("Desktop protocol response omitted request identity"))?;
        let pending = self
            .pending
            .remove(&request_id)
            .ok_or_else(|| anyhow!("Desktop protocol response has unknown request identity"))?;

        let validation = self.validate_response_identity(pending.expected, &envelope, response);
        if let Err(error) = validation {
            let message = error.to_string();
            let _ = pending.reply.send(Err(error));
            bail!(message)
        }

        if matches!(response, wire::DesktopResponse::ShutdownCompleted { .. }) {
            self.graceful_shutdown = true;
        } else if matches!(pending.expected, ExpectedResponse::Shutdown) {
            self.shutdown_requested = false;
        }
        let _ = pending.reply.send(Ok(envelope));
        Ok(())
    }

    fn validate_response_identity(
        &mut self,
        expected: ExpectedResponse,
        envelope: &wire::DesktopMessageEnvelope,
        response: &wire::DesktopResponse,
    ) -> Result<()> {
        if !expected.accepts(response) {
            bail!("Desktop protocol response kind does not match its request");
        }

        if matches!(expected, ExpectedResponse::Handshake) {
            if let wire::DesktopResponse::HandshakeAccepted { protocol_version } = response {
                if *protocol_version != wire::DESKTOP_PROTOCOL_VERSION {
                    bail!("Desktop protocol handshake accepted an unsupported version");
                }
                let epoch = envelope.connection_epoch.ok_or_else(|| {
                    anyhow!("Desktop protocol handshake response omitted connection epoch")
                })?;
                if epoch.0 == 0 {
                    bail!("Desktop protocol handshake returned a zero connection epoch");
                }
                if self.connection_epoch.is_some_and(|active| active != epoch) {
                    bail!("Desktop protocol repeated handshake changed connection epoch");
                }
                self.connection_epoch = Some(epoch);
            } else if envelope.connection_epoch != self.connection_epoch {
                bail!("Desktop protocol rejected handshake used an unexpected epoch");
            }
            return Ok(());
        }

        if envelope.connection_epoch != self.connection_epoch {
            bail!("Desktop protocol response connection epoch does not match the client")
        }
        Ok(())
    }

    fn handle_event(&mut self, envelope: wire::DesktopMessageEnvelope) -> Result<()> {
        if envelope.connection_epoch != self.connection_epoch {
            bail!("Desktop protocol event connection epoch does not match the client");
        }
        if envelope.request_id.is_some() || envelope.seq.is_none() {
            bail!("Desktop protocol event has invalid delivery identity");
        }
        match self.event_sender.try_send(Box::new(envelope)) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => {
                bail!("Desktop protocol client event buffer is full")
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                bail!("Desktop protocol client event receiver is closed")
            }
        }
    }

    fn fail_connection(&mut self, reason: String) {
        let graceful = self.graceful_shutdown;
        for (_, pending) in std::mem::take(&mut self.pending) {
            let _ = pending.reply.send(Err(anyhow!(reason.clone())));
        }
        let _ = self
            .connection_sender
            .try_send(ConnectionClosed { graceful, reason });
    }
}
