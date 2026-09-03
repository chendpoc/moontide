mod compile;

#[allow(
    unused_imports,
    reason = "the loop module will call the compiler in a later review batch"
)]
pub(crate) use compile::compile;

use crate::llm::adapter_family::AdapterFamily;
pub use crate::llm::profile_config::ContinuityHint;
use crate::llm::protocol::ThinkingLevel;

/// Immutable system instructions resolved for one user turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemPrompt {
    content: String,
}

impl SystemPrompt {
    /// Creates a system prompt from already-resolved instruction content.
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
        }
    }

    /// Returns the resolved instruction content without exposing its source state.
    pub fn content(&self) -> &str {
        &self.content
    }
}

/// Per-turn model call snapshot resolved by the agent composition root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmCallConfig {
    pub protocol: AdapterFamily,
    pub profile: crate::llm::profile_config::ResolvedProtocolProfile,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub session_id: Option<String>,
    pub continuity_hint: ContinuityHint,
}

#[cfg(test)]
mod tests;
