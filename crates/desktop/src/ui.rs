use std::collections::VecDeque;
use std::sync::Arc;

use iced::widget::text_editor;
use iced::{application, Theme};

use crate::protocol::DesktopMessageEnvelope;
use crate::render_state::RenderState;
use crate::{DesktopCommandError, DesktopHostHandle, DesktopSnapshot};

mod components;
mod composer;
mod sync;
mod update;
mod view;

#[cfg(test)]
mod tests;

/// Runs the injected Desktop UI shell. Agent configuration and Host startup stay outside D3.
pub fn run_ui(
    host: DesktopHostHandle,
    events: crate::DesktopEventStream,
    connection_epoch: crate::ConnectionEpoch,
) -> iced::Result {
    let host = Arc::new(host);
    let event_source = sync::ProtocolSource::new(events, connection_epoch);

    application(
        move || {
            let state = UiState::new(Arc::clone(&host), event_source.clone());
            (state, sync::snapshot_task(Arc::clone(&host)))
        },
        update::update,
        view::view,
    )
    .title("MoonTide")
    .theme(theme)
    .subscription(sync::subscription)
    .run()
}

#[derive(Debug, Clone)]
enum UiMessage {
    Protocol(DesktopMessageEnvelope),
    ComposerAction(text_editor::Action),
    Submit,
    Submitted {
        text: String,
        result: Result<u64, DesktopCommandError>,
    },
    Stop,
    StopCompleted(Result<(), DesktopCommandError>),
    Escape,
    ToggleInspector,
    SelectTool(String),
    SelectApproval(String),
    SelectThinking {
        turn: u64,
        llm_call_id: String,
    },
    ToggleThinking,
    Approve(String),
    Deny(String),
    ApprovalCompleted {
        approval_id: String,
        result: Result<(), DesktopCommandError>,
    },
    SnapshotLoaded(Result<DesktopSnapshot, DesktopCommandError>),
    RetrySnapshot,
}

struct UiState {
    host: Arc<DesktopHostHandle>,
    event_source: sync::ProtocolSource,
    render_state: RenderState,
    input: text_editor::Content,
    snapshot_in_flight: bool,
    snapshot_request_in_flight: bool,
    snapshot_retry_scheduled: bool,
    pending_protocol_events: VecDeque<DesktopMessageEnvelope>,
    pending_protocol_events_overflowed: bool,
    submit_in_flight: bool,
    cancellation_in_flight: bool,
    inspector_open: bool,
    inspector_selection: Option<InspectorSelection>,
    thinking_expanded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum InspectorSelection {
    Tool { tool_use_id: String },
    Approval { approval_id: String },
    Thinking { turn: u64, llm_call_id: String },
}

impl UiState {
    fn new(host: Arc<DesktopHostHandle>, event_source: sync::ProtocolSource) -> Self {
        event_source.set_events_enabled(false);
        Self {
            host,
            event_source,
            render_state: RenderState::default(),
            input: text_editor::Content::new(),
            snapshot_in_flight: true,
            snapshot_request_in_flight: true,
            snapshot_retry_scheduled: false,
            pending_protocol_events: VecDeque::new(),
            pending_protocol_events_overflowed: false,
            submit_in_flight: false,
            cancellation_in_flight: false,
            inspector_open: false,
            inspector_selection: None,
            thinking_expanded: false,
        }
    }
}

fn theme(_: &UiState) -> Theme {
    Theme::Dark
}
