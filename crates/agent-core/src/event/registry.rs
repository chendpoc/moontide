use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::run_event::RunEvent;
use super::trace_context::TraceContext;

/// Outcome of a hook handler invocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookOutcome {
    Continue,
    Block { reason: String },
}

/// Pre-commit gate; may block session writes.
pub trait HookHandler: Send + Sync {
    fn on_event(&self, ctx: &TraceContext, event: &RunEvent) -> Result<HookOutcome>;
}

/// Persists committable events to the Session Item Log (injected by `agent`).
pub trait CommitHandler: Send + Sync {
    fn commit(&self, event: &RunEvent) -> Result<Option<String>>;
}

/// Observes events for Agent Event Log / UI / sidecar (fail-open at dispatch).
pub trait ObserveHandler: Send + Sync {
    fn observe(&self, ctx: &TraceContext, event: &RunEvent) -> Result<()>;
}

/// Frozen handler table assembled before a run starts.
#[derive(Clone)]
pub struct PipelineRegistry {
    hooks: Vec<Arc<dyn HookHandler>>,
    commit: Arc<dyn CommitHandler>,
    observers: Vec<Arc<dyn ObserveHandler>>,
}

impl PipelineRegistry {
    pub fn builder() -> PipelineRegistryBuilder {
        PipelineRegistryBuilder::default()
    }

    pub(crate) fn hooks(&self) -> &[Arc<dyn HookHandler>] {
        &self.hooks
    }

    pub(crate) fn commit(&self) -> &Arc<dyn CommitHandler> {
        &self.commit
    }

    pub(crate) fn observers(&self) -> &[Arc<dyn ObserveHandler>] {
        &self.observers
    }
}

#[derive(Default)]
pub struct PipelineRegistryBuilder {
    hooks: Vec<Arc<dyn HookHandler>>,
    commit: Option<Arc<dyn CommitHandler>>,
    observers: Vec<Arc<dyn ObserveHandler>>,
}

impl PipelineRegistryBuilder {
    pub fn hook(mut self, handler: Arc<dyn HookHandler>) -> Self {
        self.hooks.push(handler);
        self
    }

    pub fn commit(mut self, handler: Arc<dyn CommitHandler>) -> Self {
        self.commit = Some(handler);
        self
    }

    pub fn observe(mut self, handler: Arc<dyn ObserveHandler>) -> Self {
        self.observers.push(handler);
        self
    }

    pub fn build_frozen(self) -> Result<PipelineRegistry> {
        let commit = self
            .commit
            .ok_or_else(|| anyhow!("PipelineRegistry requires a commit handler"))?;
        Ok(PipelineRegistry {
            hooks: self.hooks,
            commit,
            observers: self.observers,
        })
    }
}
