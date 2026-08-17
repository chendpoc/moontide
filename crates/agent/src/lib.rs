//! MoonTide's composition root for one persistent agent session.

mod agent;
mod bootstrap;
mod config;

pub use agent::Agent;
pub use config::{AgentConfig, ProviderConfig};

#[cfg(test)]
mod tests;
