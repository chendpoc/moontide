use std::fmt;

use anyhow::{anyhow, bail, Result};
use desktop::{DesktopProtocolEventStream, DesktopProtocolServerHandle};
use desktop_protocol as wire;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

#[cfg(test)]
mod tests;

pub(crate) struct ClientTransport {
    pub(crate) sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
    pub(crate) receiver: mpsc::Receiver<Result<wire::DesktopMessageEnvelope, TransportFailure>>,
}

pub(crate) struct TransportPeer {
    pub(crate) receiver: mpsc::Receiver<wire::DesktopMessageEnvelope>,
    pub(crate) sender: mpsc::Sender<Result<wire::DesktopMessageEnvelope, TransportFailure>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TransportFailure {
    message: String,
}

impl TransportFailure {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for TransportFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TransportFailure {}

pub(crate) fn transport_pair(capacity: usize) -> Result<(ClientTransport, TransportPeer)> {
    if capacity == 0 {
        bail!("Desktop protocol transport capacity must be greater than zero");
    }
    let (outgoing_sender, outgoing_receiver) = mpsc::channel(capacity);
    let (incoming_sender, incoming_receiver) = mpsc::channel(capacity);
    Ok((
        ClientTransport {
            sender: outgoing_sender,
            receiver: incoming_receiver,
        },
        TransportPeer {
            receiver: outgoing_receiver,
            sender: incoming_sender,
        },
    ))
}

pub(crate) fn connect_in_process(
    server: DesktopProtocolServerHandle,
    events: DesktopProtocolEventStream,
    capacity: usize,
) -> Result<ClientTransport> {
    tokio::runtime::Handle::try_current()
        .map_err(|_| anyhow!("In-process Desktop transport requires an active Tokio runtime"))?;
    let (client, peer) = transport_pair(capacity)?;
    tokio::spawn(run_in_process_transport(server, events, peer));
    Ok(client)
}

async fn run_in_process_transport(
    server: DesktopProtocolServerHandle,
    mut events: DesktopProtocolEventStream,
    mut peer: TransportPeer,
) {
    let mut requests = JoinSet::new();
    let mut events_open = true;
    let mut outgoing_open = true;

    loop {
        tokio::select! {
            biased;

            event = events.recv(), if events_open => {
                match event {
                    Some(envelope) => {
                        if peer.sender.send(Ok(envelope)).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        events_open = false;
                        if requests.is_empty() {
                            let _ = peer.sender.send(Err(TransportFailure::new(
                                "Desktop protocol server event stream closed unexpectedly",
                            ))).await;
                            break;
                        }
                    }
                }
            }

            completed = requests.join_next(), if !requests.is_empty() => {
                let result = match completed {
                    Some(Ok(Ok(envelope))) => Ok(envelope),
                    Some(Ok(Err(error))) => Err(TransportFailure::new(format!(
                        "Desktop protocol server request failed: {error}"
                    ))),
                    Some(Err(error)) => Err(TransportFailure::new(format!(
                        "Desktop protocol request task failed: {error}"
                    ))),
                    None => continue,
                };
                let terminal = matches!(
                    &result,
                    Ok(wire::DesktopMessageEnvelope {
                        payload: wire::DesktopMessage::Response {
                            response: wire::DesktopResponse::ShutdownCompleted { .. }
                        },
                        ..
                    })
                );
                let failed = result.is_err();
                if peer.sender.send(result).await.is_err() {
                    break;
                }
                if terminal || failed {
                    break;
                }
                if !events_open && requests.is_empty() {
                    let _ = peer.sender.send(Err(TransportFailure::new(
                        "Desktop protocol server event stream closed unexpectedly",
                    ))).await;
                    break;
                }
            }

            // The Host adapter is a serial actor. Keep at most one request task in flight so the
            // bounded outgoing channel remains the actual admission limit and preserves order.
            outgoing = peer.receiver.recv(), if outgoing_open && requests.is_empty() => {
                match outgoing {
                    Some(envelope) => {
                        let server = server.clone();
                        requests.spawn(async move { server.request(envelope).await });
                    }
                    None => {
                        outgoing_open = false;
                        if requests.is_empty() {
                            break;
                        }
                    }
                }
            }

            else => break,
        }
    }

    requests.abort_all();
}
