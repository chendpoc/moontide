//! Run-level semantic events: hook → commit → observe dispatch.

mod derive;
mod file_writer;
mod pipeline;
mod registry;
mod run_event;
mod trace_context;

pub use derive::{
    derive_agent_event, truncate_record, AgentChannel, AgentEventRecord, AgentEventWriter,
    AgentPhase, DeriveObserveHandler, MAX_AGENT_EVENT_BYTES,
};
pub use file_writer::FileAgentEventWriter;
pub use pipeline::EventDispatcher;
pub use registry::{
    CommitHandler, HookHandler, HookOutcome, ObserveHandler, PipelineRegistry,
    PipelineRegistryBuilder,
};
pub use run_event::{RunCompactionKind, RunEvent};
pub use trace_context::TraceContext;

#[cfg(test)]
mod tests;
