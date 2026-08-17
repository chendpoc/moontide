use std::sync::Arc;

use anyhow::Result;

use super::trace_context::TraceContext;
use super::turn_event::TurnEvent;

/// Post-commit extension callback. Hook errors are contained by the dispatcher.
pub trait HookHandler: Send + Sync {
    fn on_event(&self, ctx: &TraceContext, event: &TurnEvent) -> Result<()>;
}

/// Persists committable events to the Session Item Log for one dispatch.
pub trait CommitHandler {
    fn commit(&mut self, event: &TurnEvent) -> Result<Option<String>>;
}

/// Frozen post-commit hook table assembled before dispatch starts.
#[derive(Clone)]
pub struct PipelineRegistry {
    hooks: Vec<Arc<dyn HookHandler>>,
}

impl PipelineRegistry {
    pub fn builder() -> PipelineRegistryBuilder {
        PipelineRegistryBuilder::default()
    }

    pub(crate) fn hooks(&self) -> &[Arc<dyn HookHandler>] {
        &self.hooks
    }
}

#[derive(Default)]
pub struct PipelineRegistryBuilder {
    hooks: Vec<Arc<dyn HookHandler>>,
}

impl PipelineRegistryBuilder {
    pub fn hook(mut self, handler: Arc<dyn HookHandler>) -> Self {
        self.hooks.push(handler);
        self
    }

    pub fn build_frozen(self) -> Result<PipelineRegistry> {
        Ok(PipelineRegistry { hooks: self.hooks })
    }
}
