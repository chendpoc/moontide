//! LLM protocol, provider port, and (later) adapter / normalize.

pub mod protocol;

pub(crate) mod adapter;
pub(crate) mod normalize;

mod provider;

pub use protocol::*;
pub use provider::{complete, LLMProvider};

#[cfg(test)]
mod tests;
