//! Wire protocol adapters (HTTP + SSE). Not imported by agent loop.

pub mod anthropic_messages;
pub mod openai_chat;

use std::fmt;

use crate::llm::normalize::openai_chat::OpenAiChatOptions;
use crate::llm::protocol::LlmError;
use crate::llm::LLMProvider;

/// Wire protocol family (paired 1:1 with `normalize/{family}/`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterFamily {
    OpenAiChatCompletions,
    AnthropicMessages,
}

/// Adapter-specific endpoint configuration injected by the agent composition root.
#[derive(Clone)]
pub enum AdapterConfig {
    OpenAiChat {
        base_url: String,
        api_key: String,
        options: OpenAiChatOptions,
    },
    AnthropicMessages {
        base_url: String,
        api_key: String,
    },
}

impl fmt::Debug for AdapterConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OpenAiChat {
                base_url, options, ..
            } => f
                .debug_struct("OpenAiChat")
                .field("base_url", base_url)
                .field("api_key", &"<redacted>")
                .field("options", options)
                .finish(),
            Self::AnthropicMessages { base_url, .. } => f
                .debug_struct("AnthropicMessages")
                .field("base_url", base_url)
                .field("api_key", &"<redacted>")
                .finish(),
        }
    }
}

/// Construct a provider from a wire-family-specific configuration.
pub fn build_provider(config: AdapterConfig) -> Result<Box<dyn LLMProvider>, LlmError> {
    match config {
        AdapterConfig::OpenAiChat {
            base_url,
            api_key,
            options,
        } => Ok(Box::new(openai_chat::OpenAiChatAdapter::new(
            base_url, api_key, options,
        )?)),
        AdapterConfig::AnthropicMessages { base_url, api_key } => Ok(Box::new(
            anthropic_messages::AnthropicMessagesAdapter::new(base_url, api_key),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::RequestFailureKind;

    // Scenario: each adapter-specific configuration is passed to the provider factory.
    // Expected: both declared wire families construct a provider.
    // Invariant: the factory cannot receive a family/configuration mismatch.
    #[test]
    fn build_provider_covers_declared_families() {
        let openai = AdapterConfig::OpenAiChat {
            base_url: "https://example.com".into(),
            api_key: "k".into(),
            options: OpenAiChatOptions::default(),
        };
        let anthropic = AdapterConfig::AnthropicMessages {
            base_url: "https://example.com".into(),
            api_key: "k".into(),
        };
        assert!(build_provider(openai).is_ok());
        assert!(build_provider(anthropic).is_ok());
    }

    // Scenario: the OpenAI adapter receives an empty endpoint root.
    // Expected: provider construction returns an unrecoverable request error.
    // Invariant: invalid endpoints never create a runnable provider.
    #[test]
    fn build_provider_rejects_empty_base_url() {
        assert!(matches!(
            build_provider(AdapterConfig::OpenAiChat {
                base_url: String::new(),
                api_key: "k".into(),
                options: OpenAiChatOptions::default(),
            }),
            Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            })
        ));
    }

    // Scenario: an adapter config is formatted for diagnostics.
    // Expected: endpoint and family facts remain visible while the API key is redacted.
    // Invariant: secret-bearing adapter configuration never exposes raw credentials via Debug.
    #[test]
    fn adapter_config_debug_redacts_api_key() {
        let config = AdapterConfig::OpenAiChat {
            base_url: "https://example.com".into(),
            api_key: "super-secret".into(),
            options: OpenAiChatOptions::default(),
        };
        let debug = format!("{config:?}");
        assert!(!debug.contains("super-secret"));
        assert!(debug.contains("<redacted>"));
    }
}
