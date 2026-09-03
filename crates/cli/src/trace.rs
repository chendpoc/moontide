use agent::{
    PendingBlock,
    ProgressEvent,
    ProgressObserver,
};
use anyhow::Result;

use crate::settings::TraceMode;

pub(crate) struct TraceObserver {
    mode: TraceMode,
}

impl TraceObserver {
    pub(crate) fn new(mode: TraceMode) -> Self {
        Self { mode }
    }
}

impl ProgressObserver for TraceObserver {
    fn on_progress(&self, event: &ProgressEvent) -> Result<()> {
        if let Some(line) = format_progress_event(self.mode, event) {
            eprintln!("{line}");
        }
        Ok(())
    }
}

pub(crate) fn format_progress_event(mode: TraceMode, event: &ProgressEvent) -> Option<String> {
    match event {
        ProgressEvent::TurnStarted { turn } => Some(format!("[trace] turn={turn} started")),
        ProgressEvent::LlmCallStarted { turn, step, .. } => {
            Some(format!("[trace] turn={turn} step={step} llm started"))
        }
        ProgressEvent::AssistantResponseSnapshot {
            turn,
            step,
            snapshot,
            ..
        } if mode == TraceMode::EventsAndThinking => match snapshot.pending.as_ref() {
            Some(PendingBlock::Thinking { thinking }) => Some(format!(
                "[trace] turn={turn} step={step} thinking: {thinking}"
            )),
            _ => None,
        },
        ProgressEvent::AssistantResponseSnapshot { .. }
        | ProgressEvent::AssistantFinalized { .. } => None,
        ProgressEvent::ToolCall { turn, call } => Some(format!(
            "[trace] turn={turn} tool={} id={} input={}",
            call.name(),
            call.tool_use_id(),
            serde_json::to_string(call.input()).unwrap_or_else(|_| "<invalid-json>".into())
        )),
        ProgressEvent::ToolResult { turn, result } => Some(format!(
            "[trace] turn={turn} tool={} id={} result={:?}: {:?}",
            result.name(),
            result.tool_use_id(),
            result.status(),
            result.content()
        )),
        ProgressEvent::LlmCallEnded {
            turn,
            step,
            outcome,
            ..
        } => Some(format!(
            "[trace] turn={turn} step={step} llm ended outcome={outcome:?}"
        )),
        ProgressEvent::TurnEnded { turn } => Some(format!("[trace] turn={turn} ended")),
    }
}
