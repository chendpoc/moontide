use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use iced::futures::{SinkExt, Stream};
use iced::{Subscription, Task};
use tokio::sync::watch;

use super::{UiMessage, UiState};
use crate::protocol::{ConnectionEpoch, DesktopMessageEnvelope};
use crate::render_state::{RenderFoldResult, RenderState};
use crate::{DesktopCommandError, DesktopEventStream, DesktopHostHandle, DesktopSnapshot};

pub(super) const PROTOCOL_STREAM_CAPACITY: usize = 32;
const SNAPSHOT_RETRY_DELAY: Duration = Duration::from_millis(250);

#[derive(Clone)]
pub(super) struct ProtocolSource {
    stream: Arc<Mutex<Option<DesktopEventStream>>>,
    connection_epoch: ConnectionEpoch,
    events_enabled: watch::Sender<bool>,
}

impl ProtocolSource {
    pub(super) fn new(stream: DesktopEventStream, connection_epoch: ConnectionEpoch) -> Self {
        let (events_enabled, _) = watch::channel(false);
        Self {
            stream: Arc::new(Mutex::new(Some(stream))),
            connection_epoch,
            events_enabled,
        }
    }

    pub(super) fn take_stream(&self) -> Option<DesktopEventStream> {
        self.stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }

    pub(super) fn set_events_enabled(&self, enabled: bool) {
        let _ = self.events_enabled.send(enabled);
    }
}

impl Hash for ProtocolSource {
    fn hash<H: Hasher>(&self, state: &mut H) {
        Arc::as_ptr(&self.stream).hash(state);
        self.connection_epoch.hash(state);
    }
}

pub(super) fn subscription(state: &UiState) -> Subscription<UiMessage> {
    Subscription::batch([
        Subscription::run_with(state.event_source.clone(), protocol_stream)
            .map(UiMessage::Protocol),
        iced::keyboard::listen().filter_map(super::composer::keyboard_message),
    ])
}

fn protocol_stream(source: &ProtocolSource) -> impl Stream<Item = DesktopMessageEnvelope> {
    let source = source.clone();
    iced::stream::channel(PROTOCOL_STREAM_CAPACITY, async move |mut output| {
        let Some(mut events) = source.take_stream() else {
            return;
        };

        let mut events_enabled = source.events_enabled.subscribe();
        loop {
            if !*events_enabled.borrow() && events_enabled.changed().await.is_err() {
                return;
            }

            tokio::select! {
                changed = events_enabled.changed() => {
                    if changed.is_err() {
                        return;
                    }
                }
                message = events.recv_protocol(source.connection_epoch) => {
                    let Some(message) = message else {
                        return;
                    };
                    if output.send(message).await.is_err() {
                        return;
                    }
                }
            }
        }
    })
}

pub(super) fn apply_protocol_message(
    state: &mut UiState,
    envelope: DesktopMessageEnvelope,
) -> Task<UiMessage> {
    let result = state.render_state.apply_message(envelope);
    if result == RenderFoldResult::ResyncRequired && !state.snapshot_in_flight {
        begin_snapshot(state)
    } else {
        super::composer::refresh_command_phase(state);
        Task::none()
    }
}

pub(super) fn begin_snapshot(state: &mut UiState) -> Task<UiMessage> {
    state.snapshot_in_flight = true;
    state.snapshot_request_in_flight = true;
    state.snapshot_retry_scheduled = false;
    state.event_source.set_events_enabled(false);
    snapshot_task(Arc::clone(&state.host))
}

pub(super) fn schedule_snapshot_retry(state: &mut UiState) -> Task<UiMessage> {
    if state.snapshot_retry_scheduled {
        return Task::none();
    }
    state.snapshot_retry_scheduled = true;
    Task::perform(
        async {
            tokio::time::sleep(SNAPSHOT_RETRY_DELAY).await;
        },
        |_| UiMessage::RetrySnapshot,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SnapshotAction {
    Ready,
    Retry,
    Resync,
}

pub(super) fn apply_snapshot_result(
    render_state: &mut RenderState,
    pending: &mut VecDeque<DesktopMessageEnvelope>,
    pending_overflowed: &mut bool,
    result: Result<DesktopSnapshot, DesktopCommandError>,
) -> SnapshotAction {
    let Ok(snapshot) = result else {
        if let Err(error) = result {
            render_state.record_command_error(error);
        }
        return SnapshotAction::Retry;
    };

    render_state.replace_snapshot(snapshot);
    if *pending_overflowed {
        pending.clear();
        *pending_overflowed = false;
        return SnapshotAction::Resync;
    }

    if replay_pending_protocol_events(render_state, pending) == RenderFoldResult::ResyncRequired {
        pending.clear();
        SnapshotAction::Resync
    } else {
        SnapshotAction::Ready
    }
}

pub(super) fn replay_pending_protocol_events(
    render_state: &mut RenderState,
    pending: &mut VecDeque<DesktopMessageEnvelope>,
) -> RenderFoldResult {
    while let Some(envelope) = pending.pop_front() {
        let result = render_state.apply_message(envelope);
        if result == RenderFoldResult::ResyncRequired {
            return result;
        }
    }
    RenderFoldResult::Applied
}

pub(super) fn snapshot_task(host: Arc<DesktopHostHandle>) -> Task<UiMessage> {
    Task::perform(
        async move { host.snapshot().await },
        UiMessage::SnapshotLoaded,
    )
}
