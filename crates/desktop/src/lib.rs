//! Framework-independent Desktop host contract.

mod approval;
mod command;
mod event;
mod host;
mod host_protocol;
pub mod protocol;
mod state;

pub use command::DesktopCommandError;
pub use event::{DesktopEvent, DesktopEventEnvelope, DesktopEventStream};
pub use host::{DesktopConfig, DesktopHost, DesktopHostHandle, SessionSelection};
pub use host_protocol::{
    DesktopProtocolConfig, DesktopProtocolEventStream, DesktopProtocolServer,
    DesktopProtocolServerHandle,
};
pub use state::{
    ActiveAssistantCall, DeliveryStatus, DesktopError, DesktopErrorKind, DesktopRunState,
    DesktopSnapshot, ResyncReason, ShutdownReport,
};

pub use approval::{ApprovalId, ApprovalRequest};
