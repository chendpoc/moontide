//! Framework-independent Desktop host contract.

mod approval;
mod command;
mod event;
mod host;
mod protocol;
mod render_state;
mod state;
mod ui;

pub use command::DesktopCommandError;
pub use event::{DesktopEvent, DesktopEventEnvelope, DesktopEventStream};
pub use host::{DesktopConfig, DesktopHost, DesktopHostHandle, SessionSelection};
pub use protocol::{
    ConnectionEpoch, DesktopCommand, DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent,
    DesktopResponse, ProtocolVersion, RequestId, Seq, SessionSelectionDto,
    DESKTOP_PROTOCOL_VERSION,
};
pub use state::{
    ActiveAssistantCall, DeliveryStatus, DesktopError, DesktopErrorKind, DesktopRunState,
    DesktopSnapshot, ResyncReason, ShutdownReport,
};

pub use ui::run_ui;

pub use approval::{ApprovalId, ApprovalRequest};
