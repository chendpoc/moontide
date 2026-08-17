use agent::{ProgressEvent, ProgressObserver};
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
        ProgressEvent::LlmCallStarted { turn, step } => {
            Some(format!("[trace] turn={turn} step={step} llm started"))
        }
        ProgressEvent::Thinking { turn, step, text } if mode == TraceMode::EventsAndThinking => {
            Some(format!("[trace] turn={turn} step={step} thinking: {text}"))
        }
        ProgressEvent::Thinking { .. } => None,
        ProgressEvent::ToolCall {
            turn,
            name,
            tool_use_id,
            input,
        } => Some(format!(
            "[trace] turn={turn} tool={name} id={tool_use_id} input={input}"
        )),
        ProgressEvent::ToolResult {
            turn,
            name,
            tool_use_id,
            status,
            summary,
        } => Some(format!(
            "[trace] turn={turn} tool={name} id={tool_use_id} result={status}: {summary}"
        )),
        ProgressEvent::LlmCallEnded {
            turn,
            step,
            stop_reason,
        } => Some(format!(
            "[trace] turn={turn} step={step} llm ended stop={stop_reason}"
        )),
        ProgressEvent::TurnEnded { turn } => Some(format!("[trace] turn={turn} ended")),
    }
}
