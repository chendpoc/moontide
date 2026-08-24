use std::sync::Arc;

use iced::widget::text_editor;
use iced::Task;

use super::{composer, sync, UiMessage, UiState};

pub(super) fn update(state: &mut UiState, message: UiMessage) -> Task<UiMessage> {
    match message {
        UiMessage::Protocol(envelope) => {
            if state.snapshot_in_flight {
                if state.pending_protocol_events_overflowed {
                    return Task::none();
                }
                if state.pending_protocol_events.len() >= sync::PROTOCOL_STREAM_CAPACITY {
                    state.pending_protocol_events.clear();
                    state.pending_protocol_events_overflowed = true;
                } else {
                    state.pending_protocol_events.push_back(envelope);
                }
                Task::none()
            } else {
                sync::apply_protocol_message(state, envelope)
            }
        }
        UiMessage::ComposerAction(action) => {
            if composer::allows_edit(state) {
                state.input.perform(action);
            }
            Task::none()
        }
        UiMessage::Submit => {
            if !composer::allows_submit(state) {
                return Task::none();
            }
            let text = state.input.text();
            if text.trim().is_empty() {
                return Task::none();
            }
            state.input = text_editor::Content::new();
            state.submit_in_flight = true;

            let host = Arc::clone(&state.host);
            Task::perform(
                async move {
                    let result = host.submit_turn(text.clone()).await;
                    (text, result)
                },
                |(text, result)| UiMessage::Submitted { text, result },
            )
        }
        UiMessage::Submitted { text, result } => {
            match result {
                Ok(_) => {}
                Err(error) => {
                    state.submit_in_flight = false;
                    if state.input.text().trim().is_empty() {
                        state.input = text_editor::Content::with_text(&text);
                    }
                    state.render_state.record_command_error(error);
                }
            }
            Task::none()
        }
        UiMessage::Stop => {
            if !composer::allows_stop(state) {
                return Task::none();
            }
            state.cancellation_in_flight = true;
            let host = Arc::clone(&state.host);
            Task::perform(
                async move { host.cancel_turn().await },
                UiMessage::StopCompleted,
            )
        }
        UiMessage::StopCompleted(result) => {
            if let Err(error) = result {
                state.cancellation_in_flight = false;
                state.render_state.record_command_error(error);
            }
            composer::refresh_command_phase(state);
            Task::none()
        }
        UiMessage::Escape => {
            if composer::allows_stop(state) {
                state.cancellation_in_flight = true;
                let host = Arc::clone(&state.host);
                Task::perform(
                    async move { host.cancel_turn().await },
                    UiMessage::StopCompleted,
                )
            } else {
                state.inspector_open = false;
                Task::none()
            }
        }
        UiMessage::ToggleInspector => {
            state.inspector_open = !state.inspector_open;
            Task::none()
        }
        UiMessage::SelectTool(tool_use_id) => {
            state.inspector_selection = Some(super::InspectorSelection::Tool { tool_use_id });
            state.inspector_open = true;
            Task::none()
        }
        UiMessage::SelectApproval(approval_id) => {
            state.inspector_selection = Some(super::InspectorSelection::Approval { approval_id });
            state.inspector_open = true;
            Task::none()
        }
        UiMessage::SelectThinking { turn, llm_call_id } => {
            state.inspector_selection =
                Some(super::InspectorSelection::Thinking { turn, llm_call_id });
            state.inspector_open = true;
            Task::none()
        }
        UiMessage::ToggleThinking => {
            state.thinking_expanded = !state.thinking_expanded;
            Task::none()
        }
        UiMessage::Approve(approval_id) => {
            if !composer::allows_approval(state) {
                return Task::none();
            }
            let host = Arc::clone(&state.host);
            let id = approval_id.clone();
            Task::perform(
                async move { host.approve(approval_id).await },
                move |result| UiMessage::ApprovalCompleted {
                    approval_id: id,
                    result,
                },
            )
        }
        UiMessage::Deny(approval_id) => {
            if !composer::allows_approval(state) {
                return Task::none();
            }
            let host = Arc::clone(&state.host);
            let id = approval_id.clone();
            Task::perform(
                async move { host.deny(approval_id, "denied by user".into()).await },
                move |result| UiMessage::ApprovalCompleted {
                    approval_id: id,
                    result,
                },
            )
        }
        UiMessage::ApprovalCompleted {
            approval_id,
            result,
        } => {
            match result {
                Ok(()) => {
                    state.render_state.approvals.remove(&approval_id);
                }
                Err(error) => state.render_state.record_command_error(error),
            }
            Task::none()
        }
        UiMessage::SnapshotLoaded(result) => {
            state.snapshot_request_in_flight = false;
            match sync::apply_snapshot_result(
                &mut state.render_state,
                &mut state.pending_protocol_events,
                &mut state.pending_protocol_events_overflowed,
                result,
            ) {
                sync::SnapshotAction::Ready => {
                    state.snapshot_in_flight = false;
                    state.snapshot_retry_scheduled = false;
                    state.event_source.set_events_enabled(true);
                    composer::refresh_command_phase(state);
                    Task::none()
                }
                sync::SnapshotAction::Retry => {
                    state.snapshot_in_flight = true;
                    state.event_source.set_events_enabled(false);
                    sync::schedule_snapshot_retry(state)
                }
                sync::SnapshotAction::Resync => sync::begin_snapshot(state),
            }
        }
        UiMessage::RetrySnapshot => {
            state.snapshot_retry_scheduled = false;
            if state.snapshot_in_flight && !state.snapshot_request_in_flight {
                state.snapshot_request_in_flight = true;
                sync::snapshot_task(Arc::clone(&state.host))
            } else {
                Task::none()
            }
        }
    }
}
