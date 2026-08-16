//! Run-level semantic events: hook → commit → observe dispatch.

mod agent_recorder;
mod derive;
mod file_writer;
mod pipeline;
mod registry;
mod run_event;
mod trace_context;

pub use agent_recorder::{AgentEventRecorder, DeriveObserveHandler, FileAgentEventRecorder};
pub use derive::{derive_agent_event, AgentChannel, AgentEventRecord, AgentPhase};
pub use pipeline::EventDispatcher;
pub use registry::{
    CommitHandler, HookHandler, HookOutcome, ObserveHandler, PipelineRegistry,
    PipelineRegistryBuilder,
};
pub use run_event::{RunCompactionKind, RunEvent};
pub use trace_context::TraceContext;

#[cfg(test)]
mod tests;
