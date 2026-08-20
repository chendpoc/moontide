use std::fmt;

use tokio::sync::oneshot;

use crate::{state::ShutdownReport, DesktopSnapshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopCommandError {
    ProtocolVersionUnsupported,
    HandshakeRequired,
    SessionNotStarted,
    SessionAlreadyStarted,
    Busy,
    NoActiveTurn,
    ApprovalNotFound,
    ApprovalAlreadyResolved,
    Stopping,
    Stopped,
    EventStreamClosed,
    InvalidInput(String),
    Internal(String),
}

impl fmt::Display for DesktopCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProtocolVersionUnsupported => {
                formatter.write_str("desktop protocol version is unsupported")
            }
            Self::HandshakeRequired => {
                formatter.write_str("desktop protocol handshake is required")
            }
            Self::SessionNotStarted => formatter.write_str("desktop session has not started"),
            Self::SessionAlreadyStarted => {
                formatter.write_str("desktop session has already started")
            }
            Self::Busy => formatter.write_str("desktop host is busy"),
            Self::NoActiveTurn => formatter.write_str("desktop host has no active turn"),
            Self::ApprovalNotFound => formatter.write_str("approval request not found"),
            Self::ApprovalAlreadyResolved => formatter.write_str("approval request is resolved"),
            Self::Stopping => formatter.write_str("desktop host is stopping"),
            Self::Stopped => formatter.write_str("desktop host is stopped"),
            Self::EventStreamClosed => formatter.write_str("desktop event stream is closed"),
            Self::InvalidInput(message) => write!(formatter, "invalid desktop input: {message}"),
            Self::Internal(message) => write!(formatter, "desktop host error: {message}"),
        }
    }
}

impl std::error::Error for DesktopCommandError {}

pub(crate) enum HostCommand {
    SubmitTurn {
        text: String,
        reply: oneshot::Sender<Result<u64, DesktopCommandError>>,
    },
    CancelTurn {
        reply: oneshot::Sender<Result<(), DesktopCommandError>>,
    },
    Approve {
        request_id: String,
        reply: oneshot::Sender<Result<(), DesktopCommandError>>,
    },
    Deny {
        request_id: String,
        reason: String,
        reply: oneshot::Sender<Result<(), DesktopCommandError>>,
    },
    Snapshot {
        reply: oneshot::Sender<Result<DesktopSnapshot, DesktopCommandError>>,
    },
    Shutdown {
        reply: oneshot::Sender<Result<ShutdownReport, DesktopCommandError>>,
    },
}
