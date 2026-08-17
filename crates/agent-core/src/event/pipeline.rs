use anyhow::Result;

use super::registry::{CommitHandler, PipelineRegistry};
use super::trace_context::TraceContext;
use super::turn_event::TurnEvent;

/// Dispatches `TurnEvent` through commit → post-commit hooks.
pub struct EventDispatcher {
    registry: PipelineRegistry,
    trace: TraceContext,
}

impl EventDispatcher {
    pub fn new(registry: PipelineRegistry, trace: TraceContext) -> Self {
        Self { registry, trace }
    }

    pub fn trace(&self) -> &TraceContext {
        &self.trace
    }

    pub fn emit(&mut self, commit: &mut dyn CommitHandler, event: TurnEvent) -> Result<()> {
        self.trace.session_item_id = None;
        self.trace.tool_use_id = None;
        self.trace.llm_call_id = None;
        apply_event_to_trace(&mut self.trace, &event);

        if event.is_committable() {
            let item_id = commit.commit(&event)?;
            self.trace.session_item_id = item_id;
        }

        for (hook_index, hook) in self.registry.hooks().iter().enumerate() {
            if let Err(error) = hook.on_event(&self.trace, &event) {
                eprintln!(
                    "event hook failed: index={hook_index}, event={event:?}, error={error:#}"
                );
            }
        }

        Ok(())
    }
}

fn apply_event_to_trace(trace: &mut TraceContext, event: &TurnEvent) {
    match event {
        TurnEvent::TurnStarted { turn } | TurnEvent::TurnEnded { turn } => {
            trace.turn = *turn;
        }
        TurnEvent::UserPromptCommitted { turn, .. }
        | TurnEvent::AssistantFinalized { turn, .. }
        | TurnEvent::CompactionApplied { turn, .. }
        | TurnEvent::CompactionRecommended { turn }
        | TurnEvent::ContextPreflightEnded { turn }
        | TurnEvent::ContextPostflightEnded { turn } => {
            trace.turn = *turn;
        }
        TurnEvent::ToolCallRecorded { turn, call } => {
            trace.turn = *turn;
            trace.tool_use_id = Some(call.tool_use_id().to_owned());
        }
        TurnEvent::ToolResultRecorded { turn, result } => {
            trace.turn = *turn;
            trace.tool_use_id = Some(result.tool_use_id().to_owned());
        }
        TurnEvent::LlmCallStarted {
            turn,
            step,
            llm_call_id,
        }
        | TurnEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            ..
        }
        | TurnEvent::MessageUpdate {
            turn,
            step,
            llm_call_id,
            ..
        } => {
            trace.turn = *turn;
            trace.step = *step;
            trace.llm_call_id = Some(llm_call_id.clone());
        }
    }
}
