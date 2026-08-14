//! Wire protocol adapters (HTTP + SSE). Not imported by agent loop.

pub mod anthropic_messages;
pub mod openai_chat;

use crate::llm::protocol::{LlmError, RequestFailureKind};
use crate::llm::LLMProvider;

/// Wire protocol family (paired 1:1 with `normalize/{family}/`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterFamily {
    OpenAiChatCompletions,
    AnthropicMessages,
}

/// Endpoint credentials injected by the agent composition root.
#[derive(Debug, Clone)]
pub struct AdapterConfig {
    pub base_url: String,
    pub api_key: String,
}

/// Construct a provider for the given wire family.
pub fn build_provider(
    family: AdapterFamily,
    config: AdapterConfig,
) -> Result<Box<dyn LLMProvider>, LlmError> {
    match family {
        AdapterFamily::OpenAiChatCompletions => Ok(Box::new(
            openai_chat::OpenAiChatAdapter::new(config)?,
        )),
        AdapterFamily::AnthropicMessages => Ok(Box::new(
            anthropic_messages::AnthropicMessagesAdapter::new(config),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_provider_covers_declared_families() {
        let config = AdapterConfig {
            base_url: "https://example.com".into(),
            api_key: "k".into(),
        };
        assert!(build_provider(AdapterFamily::OpenAiChatCompletions, config.clone()).is_ok());
        assert!(build_provider(AdapterFamily::AnthropicMessages, config).is_ok());
    }

    #[test]
    fn build_provider_rejects_empty_base_url() {
        assert!(matches!(
            build_provider(
                AdapterFamily::OpenAiChatCompletions,
                AdapterConfig {
                    base_url: String::new(),
                    api_key: "k".into(),
                },
            ),
            Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            })
        ));
    }
}
