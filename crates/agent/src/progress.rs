use std::sync::Arc;

use agent_core::event::{HookHandler, TraceContext, TurnEvent};
use anyhow::{Context, Result};

use crate::config::ProgressObserver;

/// Safe semantic progress events exposed by the composition root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProgressEvent {
    TurnStarted {
        turn: u64,
    },
    LlmCallStarted {
        turn: u64,
        step: u32,
    },
    Thinking {
        turn: u64,
        step: u32,
        text: String,
    },
    ToolCall {
        turn: u64,
        name: String,
        tool_use_id: String,
        input: String,
    },
    ToolResult {
        turn: u64,
        name: String,
        tool_use_id: String,
        status: String,
        summary: String,
    },
    LlmCallEnded {
        turn: u64,
        step: u32,
        stop_reason: String,
    },
    TurnEnded {
        turn: u64,
    },
}

pub(crate) struct ProgressHook {
    observer: Arc<dyn ProgressObserver>,
}

impl ProgressHook {
    pub(crate) fn new(observer: Arc<dyn ProgressObserver>) -> Self {
        Self { observer }
    }
}

impl HookHandler for ProgressHook {
    fn on_event(&self, ctx: &TraceContext, event: &TurnEvent) -> Result<()> {
        if let Some(progress) = derive_progress(ctx, event)? {
            self.observer.on_progress(&progress)?;
        }
        Ok(())
    }
}

fn derive_progress(_ctx: &TraceContext, event: &TurnEvent) -> Result<Option<ProgressEvent>> {
    let progress = match event {
        TurnEvent::TurnStarted { turn } => Some(ProgressEvent::TurnStarted { turn: *turn }),
        TurnEvent::LlmCallStarted { turn, step, .. } => Some(ProgressEvent::LlmCallStarted {
            turn: *turn,
            step: *step,
        }),
        TurnEvent::LlmCallEnded {
            turn,
            step,
            stop_reason,
            ..
        } => Some(ProgressEvent::LlmCallEnded {
            turn: *turn,
            step: *step,
            stop_reason: format!("{stop_reason:?}"),
        }),
        TurnEvent::ToolCallRecorded { turn, call } => Some(ProgressEvent::ToolCall {
            turn: *turn,
            name: call.name().to_owned(),
            tool_use_id: call.tool_use_id().to_owned(),
            input: bounded_json(call.input()).context("serialize progress tool input")?,
        }),
        TurnEvent::ToolResultRecorded { turn, result } => Some(ProgressEvent::ToolResult {
            turn: *turn,
            name: result.name().to_owned(),
            tool_use_id: result.tool_use_id().to_owned(),
            status: format!("{:?}", result.status()),
            summary: bounded_content(result.content())?,
        }),
        TurnEvent::MessageUpdate {
            turn,
            step,
            snapshot,
            ..
        } => match snapshot.pending.as_ref() {
            Some(agent_core::llm::protocol::PendingBlock::Thinking { thinking }) => {
                Some(ProgressEvent::Thinking {
                    turn: *turn,
                    step: *step,
                    text: truncate(thinking),
                })
            }
            _ => None,
        },
        TurnEvent::TurnEnded { turn } => Some(ProgressEvent::TurnEnded { turn: *turn }),
        _ => None,
    };
    Ok(progress)
}

fn bounded_json(value: &serde_json::Value) -> Result<String> {
    let serialized = serde_json::to_string(value).context("serialize progress JSON")?;
    Ok(truncate(&serialized))
}

fn bounded_content(content: &agent_core::tools::ToolContent) -> Result<String> {
    let text = match content {
        agent_core::tools::ToolContent::Text(text) => text.clone(),
        agent_core::tools::ToolContent::Json(value) => {
            serde_json::to_string(value).context("serialize progress result JSON")?
        }
    };
    Ok(truncate(&text))
}

fn truncate(value: &str) -> String {
    const MAX_CHARS: usize = 512;
    let mut chars = value.chars();
    let result = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{result}…")
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::{
        event::{TraceContext, TurnEvent},
        tools::{ToolCall, ToolContent, ToolResult},
    };

    #[test]
    // Scenario: a committed ToolCall is mapped at the agent progress boundary.
    // Expected: identity and bounded JSON input are preserved without exposing core event types.
    // Invariant: progress derivation is read-only and has no Session or filesystem side effect.
    fn derives_tool_call_progress() {
        let call = ToolCall::new("tool-1", "bash", serde_json::json!({"command": "pwd"}))
            .expect("tool call should be valid");
        let progress = derive_progress(
            &TraceContext::new("run-1", "session-1"),
            &TurnEvent::ToolCallRecorded { turn: 2, call },
        )
        .expect("progress derivation should succeed")
        .expect("tool call should produce progress");

        assert!(matches!(
            progress,
            ProgressEvent::ToolCall {
                turn: 2,
                name,
                tool_use_id,
                input
            } if name == "bash" && tool_use_id == "tool-1" && input.contains("pwd")
        ));
    }

    #[test]
    // Scenario: a long tool result enters the progress observer boundary.
    // Expected: its summary is bounded while status and identity remain explicit.
    // Invariant: progress output cannot grow without a limit from tool payload size.
    fn bounds_tool_result_summary() {
        let call = ToolCall::new("tool-1", "read", serde_json::json!({})).expect("call");
        let result = ToolResult::succeeded(&call, ToolContent::Text("x".repeat(1_000)));
        let progress = derive_progress(
            &TraceContext::new("run-1", "session-1"),
            &TurnEvent::ToolResultRecorded { turn: 1, result },
        )
        .expect("progress derivation should succeed")
        .expect("tool result should produce progress");

        match progress {
            ProgressEvent::ToolResult { summary, .. } => assert!(summary.chars().count() <= 513),
            other => panic!("expected tool result progress, got {other:?}"),
        }
    }
}
