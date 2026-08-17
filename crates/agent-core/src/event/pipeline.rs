use anyhow::Result;

use super::registry::{HookOutcome, PipelineRegistry};
use super::trace_context::TraceContext;
use super::turn_event::TurnEvent;

/// Dispatches `TurnEvent` through hook → commit → observe.
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

    pub fn emit(&mut self, event: TurnEvent) -> Result<()> {
        apply_event_to_trace(&mut self.trace, &event);

        if event.is_committable() {
            for hook in self.registry.hooks() {
                match hook.on_event(&self.trace, &event)? {
                    HookOutcome::Continue => {}
                    HookOutcome::Block { .. } => return Ok(()),
                }
            }

            let item_id = self.registry.commit().commit(&event)?;
            self.trace.session_item_id = item_id;
        }

        for observer in self.registry.observers() {
            let _ = observer.observe(&self.trace, &event);
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
