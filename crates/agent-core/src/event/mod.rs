//! Run-level semantic events: hook → commit → observe dispatch.

mod pipeline;
mod registry;
mod run_event;
mod trace_context;

#[cfg(test)]
mod tests;

pub use pipeline::EventDispatcher;
pub use registry::{
    CommitHandler, HookHandler, HookOutcome, ObserveHandler, PipelineRegistry,
    PipelineRegistryBuilder,
};
pub use run_event::RunEvent;
pub use trace_context::TraceContext;
