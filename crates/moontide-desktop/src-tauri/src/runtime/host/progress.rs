use anyhow::Result;
use std::sync::{Arc, Mutex};

use super::super::event::{DesktopEvent, EventBuffer};
use super::super::state::DesktopRunState;

pub(super) struct ProgressSink {
    pub(super) session_id: Arc<Mutex<String>>,
    pub(super) shared_state: Arc<Mutex<DesktopRunState>>,
    pub(super) buffer: Arc<EventBuffer>,
}

impl agent::ProgressObserver for ProgressSink {
    fn on_progress(&self, event: &agent::ProgressEvent) -> Result<()> {
        let session_id = self
            .session_id
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(state) = progress_state(event) {
            *self
                .shared_state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = state.clone();
            let _ = self
                .buffer
                .publish(&session_id, DesktopEvent::StateChanged { state });
        }
        let _ = self.buffer.publish(
            &session_id,
            DesktopEvent::Progress {
                event: event.clone(),
            },
        );
        Ok(())
    }
}

fn progress_state(event: &agent::ProgressEvent) -> Option<DesktopRunState> {
    match event {
        agent::ProgressEvent::TurnStarted { turn } => Some(DesktopRunState::Thinking {
            turn: *turn,
            step: 0,
        }),
        agent::ProgressEvent::LlmCallStarted { turn, step, .. } => {
            Some(DesktopRunState::Thinking {
                turn: *turn,
                step: *step,
            })
        }
        agent::ProgressEvent::ToolCall { turn, call } => Some(DesktopRunState::RunningTool {
            turn: *turn,
            tool_use_id: call.tool_use_id().to_owned(),
            name: call.name().to_owned(),
        }),
        _ => None,
    }
}
