//! LLM protocol, provider port, adapter / normalize.

pub mod adapter_family;
pub mod profile_config;
pub mod protocol;

pub mod adapter;
pub mod normalize;

mod provider;
mod response_builder;

pub use adapter_family::AdapterFamily;
pub use profile_config::*;
pub use protocol::*;
pub use provider::{
    LLMProvider,
    complete,
    run_model_call,
    run_model_call_with_updates,
};
pub use response_builder::ModelResponseBuilder;

#[cfg(test)]
mod tests;
