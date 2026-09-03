//! Wire protocol adapters (HTTP + SSE). Not imported by agent loop.

mod sse;

pub mod anthropic_messages;
pub mod google_generative_ai;
pub mod openai_chat;
pub mod openai_responses;

use std::fmt;

pub use crate::llm::adapter_family::AdapterFamily;
use crate::llm::normalize::openai_chat::OpenAiChatOptions;
use crate::llm::profile_config::{
    AdapterOptions,
    ProtocolFeatureSet,
    ResolvedProtocolProfile,
    WireProfileConfig,
};
use crate::llm::protocol::LlmError;
use crate::llm::LLMProvider;

/// Adapter-specific endpoint configuration injected by the agent composition root.
#[derive(Clone)]
pub enum AdapterConfig {
    OpenAiChat {
        base_url: String,
        api_key: String,
        options: OpenAiChatOptions,
    },
    OpenAiResponses {
        base_url: String,
        api_key: String,
        wire: WireProfileConfig,
        store_enabled: bool,
        previous_id_enabled: bool,
    },
    AnthropicMessages {
        base_url: String,
        api_key: String,
        prompt_cache: bool,
    },
    GoogleGenerativeAi {
        base_url: String,
        api_key: String,
    },
}

impl AdapterConfig {
    pub fn from_resolved(
        profile: &ResolvedProtocolProfile,
        base_url: String,
        api_key: String,
    ) -> Self {
        match profile.protocol {
            AdapterFamily::OpenAiChatCompletions => {
                let options = match profile.options {
                    AdapterOptions::OpenAiChat(options) => options,
                    _ => OpenAiChatOptions::default(),
                };
                Self::OpenAiChat {
                    base_url,
                    api_key,
                    options,
                }
            }
            AdapterFamily::OpenAiResponses => Self::OpenAiResponses {
                base_url,
                api_key,
                wire: profile.wire.clone(),
                store_enabled: profile
                    .features
                    .enabled
                    .contains(ProtocolFeatureSet::RESPONSES_STORE),
                previous_id_enabled: profile
                    .features
                    .enabled
                    .contains(ProtocolFeatureSet::RESPONSES_PREVIOUS_ID),
            },
            AdapterFamily::AnthropicMessages => Self::AnthropicMessages {
                base_url,
                api_key,
                prompt_cache: profile
                    .features
                    .enabled
                    .contains(ProtocolFeatureSet::ANTHROPIC_PROMPT_CACHE),
            },
            AdapterFamily::GoogleGenerativeAi => Self::GoogleGenerativeAi { base_url, api_key },
        }
    }

    pub fn family(&self) -> AdapterFamily {
        match self {
            Self::OpenAiChat { .. } => AdapterFamily::OpenAiChatCompletions,
            Self::OpenAiResponses { .. } => AdapterFamily::OpenAiResponses,
            Self::AnthropicMessages { .. } => AdapterFamily::AnthropicMessages,
            Self::GoogleGenerativeAi { .. } => AdapterFamily::GoogleGenerativeAi,
        }
    }
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
            Self::OpenAiResponses { base_url, .. } => f
                .debug_struct("OpenAiResponses")
                .field("base_url", base_url)
                .field("api_key", &"<redacted>")
                .finish(),
            Self::AnthropicMessages { base_url, .. } => f
                .debug_struct("AnthropicMessages")
                .field("base_url", base_url)
                .field("api_key", &"<redacted>")
                .finish(),
            Self::GoogleGenerativeAi { base_url, .. } => f
                .debug_struct("GoogleGenerativeAi")
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
        AdapterConfig::OpenAiResponses {
            base_url,
            api_key,
            wire,
            store_enabled,
            previous_id_enabled,
        } => Ok(Box::new(openai_responses::OpenAiResponsesAdapter::new(
            base_url,
            api_key,
            wire,
            store_enabled,
            previous_id_enabled,
        )?)),
        AdapterConfig::AnthropicMessages {
            base_url,
            api_key,
            prompt_cache,
        } => Ok(Box::new(anthropic_messages::AnthropicMessagesAdapter::new(
            base_url,
            api_key,
            prompt_cache,
        )?)),
        AdapterConfig::GoogleGenerativeAi { base_url, api_key } => Ok(Box::new(
            google_generative_ai::GoogleGenerativeAiAdapter::new(base_url, api_key)?,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::RequestFailureKind;

    // Scenario: each adapter-specific configuration is passed to the provider factory.
    // Expected: every declared wire family constructs a provider.
    // Invariant: the factory cannot receive a family/configuration mismatch.
    #[test]
    fn build_provider_covers_declared_families() {
        let configs = [
            AdapterConfig::OpenAiChat {
                base_url: "https://example.com".into(),
                api_key: "k".into(),
                options: OpenAiChatOptions::default(),
            },
            AdapterConfig::OpenAiResponses {
                base_url: "https://example.com".into(),
                api_key: "k".into(),
                wire: WireProfileConfig::default(),
                store_enabled: false,
                previous_id_enabled: false,
            },
            AdapterConfig::AnthropicMessages {
                base_url: "https://example.com".into(),
                api_key: "k".into(),
                prompt_cache: false,
            },
            AdapterConfig::GoogleGenerativeAi {
                base_url: "https://example.com".into(),
                api_key: "k".into(),
            },
        ];
        for config in configs {
            assert!(build_provider(config).is_ok());
        }
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
