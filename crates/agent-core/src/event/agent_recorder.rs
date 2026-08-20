use super::derive::{derive_agent_event, AgentEventRecord};
use super::registry::HookHandler;
use super::trace_context::TraceContext;
use super::turn_event::TurnEvent;

/// Receives a derived Agent Event record.
pub trait AgentEventRecorder: Send + Sync {
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}

/// Post-commit hook that derives Agent Event records and appends them.
pub struct DeriveAgentEventHook<W> {
    recorder: W,
}

impl<W> DeriveAgentEventHook<W>
where
    W: AgentEventRecorder,
{
    pub fn new(recorder: W) -> Self {
        Self { recorder }
    }
}

impl<W> HookHandler for DeriveAgentEventHook<W>
where
    W: AgentEventRecorder,
{
    fn on_event(&self, ctx: &TraceContext, event: &TurnEvent) -> anyhow::Result<()> {
        if let Some(record) = derive_agent_event(ctx, event)? {
            self.recorder.append(record)?;
        }
        Ok(())
    }
}
