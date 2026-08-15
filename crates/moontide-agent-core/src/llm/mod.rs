//! LLM protocol, provider port, adapter / normalize.

pub mod protocol;

pub mod adapter;
pub mod normalize;

mod provider;
mod response_builder;

pub use protocol::*;
pub use provider::{complete, run_model_call, run_model_call_with_updates, LLMProvider};
pub use response_builder::ModelResponseBuilder;

#[cfg(test)]
mod tests;
