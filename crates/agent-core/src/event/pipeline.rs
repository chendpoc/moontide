use anyhow::Result;

use super::registry::{HookOutcome, PipelineRegistry};
use super::run_event::RunEvent;
use super::trace_context::TraceContext;

/// Dispatches `RunEvent` through hook → commit → observe.
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

    pub fn emit(&mut self, event: RunEvent) -> Result<()> {
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

fn apply_event_to_trace(trace: &mut TraceContext, event: &RunEvent) {
    match event {
        RunEvent::TurnStarted { turn } | RunEvent::TurnEnded { turn } => {
            trace.turn = *turn;
        }
        RunEvent::UserPromptCommitted { turn, .. }
        | RunEvent::AssistantFinalized { turn, .. }
        | RunEvent::CompactionApplied { turn, .. }
        | RunEvent::CompactionRecommended { turn }
        | RunEvent::ContextPreflightEnded { turn }
        | RunEvent::ContextPostflightEnded { turn } => {
            trace.turn = *turn;
        }
        RunEvent::ToolInvocationRecorded {
            turn, tool_use_id, ..
        }
        | RunEvent::ToolOutcomeRecorded {
            turn, tool_use_id, ..
        } => {
            trace.turn = *turn;
            trace.tool_use_id = Some(tool_use_id.clone());
        }
        RunEvent::LlmCallStarted {
            turn,
            step,
            llm_call_id,
        }
        | RunEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            ..
        }
        | RunEvent::MessageUpdate {
            turn,
            step,
            llm_call_id,
            ..
        } => {
            trace.turn = *turn;
            trace.step = *step;
            trace.llm_call_id = Some(llm_call_id.clone());
        }
        RunEvent::RunStarted { .. } | RunEvent::RunEnded { .. } => {}
    }
}
