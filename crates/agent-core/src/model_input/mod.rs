mod compile;

use crate::llm::protocol::ThinkingLevel;

#[allow(
    unused_imports,
    reason = "the loop module will call the compiler in a later review batch"
)]
pub(crate) use compile::compile;

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

/// Model-call settings resolved by the agent composition root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelRequestConfig {
    pub model: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub session_id: Option<String>,
}

#[cfg(test)]
mod tests;
