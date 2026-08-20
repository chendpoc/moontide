//! Framework-independent Desktop host contract.

mod approval;
mod command;
mod event;
mod host;
mod protocol;
mod state;

pub use command::DesktopCommandError;
pub use event::{DesktopEvent, DesktopEventEnvelope, DesktopEventStream};
pub use host::{DesktopConfig, DesktopHost, DesktopHostHandle, SessionSelection};
pub use protocol::{
    ConnectionEpoch, DesktopCommand, DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent,
    DesktopResponse, ProtocolVersion, RequestId, Seq, SessionSelectionDto,
    DESKTOP_PROTOCOL_VERSION,
};
pub use state::{
    DeliveryStatus, DesktopError, DesktopErrorKind, DesktopRunState, DesktopSnapshot, ResyncReason,
    ShutdownReport,
};

pub use approval::{ApprovalId, ApprovalRequest};
