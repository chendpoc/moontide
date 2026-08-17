//! Turn-level semantic events: hook → commit → observe dispatch.

mod agent_recorder;
mod derive;
mod file_writer;
mod pipeline;
mod registry;
mod trace_context;
mod turn_event;

pub use agent_recorder::{AgentEventRecorder, DeriveObserveHandler, FileAgentEventRecorder};
pub use derive::{derive_agent_event, AgentChannel, AgentEventRecord, AgentPhase};
pub use pipeline::EventDispatcher;
pub use registry::{
    CommitHandler, HookHandler, HookOutcome, ObserveHandler, PipelineRegistry,
    PipelineRegistryBuilder,
};
pub use trace_context::TraceContext;
pub use turn_event::{TurnCompactionKind, TurnEvent};

#[cfg(test)]
mod tests;
