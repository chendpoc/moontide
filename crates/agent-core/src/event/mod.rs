//! Turn-level semantic events: commit → post-commit hook dispatch.

mod agent_recorder;
mod derive;
mod observer_bridge;
mod pipeline;
mod registry;
mod trace_context;
mod turn_event;

pub use agent_recorder::{AgentEventRecorder, DeriveAgentEventHook};
pub use derive::{derive_agent_event, AgentChannel, AgentEventRecord, AgentPhase};
pub use observer_bridge::{ObserverBridge, ObserverEvent};
pub use pipeline::EventDispatcher;
pub use registry::{CommitHandler, HookHandler, PipelineRegistry, PipelineRegistryBuilder};
pub use trace_context::TraceContext;
pub use turn_event::{LlmCallFailureKind, LlmCallOutcome, TurnCompactionKind, TurnEvent};

#[cfg(test)]
mod tests;
