//! Concrete provider/model catalog owned by the agent composition root.

use std::fmt;

use agent_core::llm::{
    adapter::AdapterFamily,
    normalize::openai_chat::{OpenAiChatOptions, OpenAiThinkingExtension},
};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

/// Vendor identifier persisted by CLI/Desktop hosts.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    #[default]
    Deepseek,
    Agnes,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deepseek => "deepseek",
            Self::Agnes => "agnes",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "deepseek" => Ok(Self::Deepseek),
            "agnes" => Ok(Self::Agnes),
            other => bail!("unknown provider: {other}"),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Deepseek => "DeepSeek",
            Self::Agnes => "Agnes AI",
        }
    }
}

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One concrete model and its fixed adapter defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmModel {
    pub id: &'static str,
    pub label: &'static str,
    pub family: AdapterFamily,
    pub base_url: &'static str,
    pub supports_thinking: bool,
    pub openai_chat: OpenAiChatOptions,
}

/// Provider metadata with an owned model slice and an internally valid default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderEntry {
    id: ProviderId,
    api_key_env: &'static str,
    models: &'static [LlmModel],
}

impl ProviderEntry {
    pub fn id(self) -> ProviderId {
        self.id
    }

    pub fn api_key_env(self) -> &'static str {
        self.api_key_env
    }

    pub fn models(self) -> &'static [LlmModel] {
        self.models
    }

    pub fn default_model_id(self) -> &'static str {
        self.default_model().id
    }

    fn default_model(self) -> &'static LlmModel {
        match self.id {
            ProviderId::Deepseek => &DEEPSEEK_CHAT,
            ProviderId::Agnes => &AGNES_25_FLASH,
        }
    }
}

const DEEPSEEK_CHAT: LlmModel = LlmModel {
    id: "deepseek-chat",
    label: "deepseek-chat",
    family: AdapterFamily::OpenAiChatCompletions,
    base_url: "https://api.deepseek.com",
    supports_thinking: true,
    openai_chat: OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::None,
    },
};

const AGNES_25_FLASH: LlmModel = LlmModel {
    id: "agnes-2.5-flash",
    label: "agnes-2.5-flash (agent)",
    family: AdapterFamily::OpenAiChatCompletions,
    base_url: "https://api.agnes-ai.cn/v1",
    supports_thinking: true,
    openai_chat: OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::ChatTemplateKwargs,
    },
};

const AGNES_20_FLASH: LlmModel = LlmModel {
    id: "agnes-2.0-flash",
    label: "agnes-2.0-flash",
    family: AdapterFamily::OpenAiChatCompletions,
    base_url: "https://api.agnes-ai.cn/v1",
    supports_thinking: true,
    openai_chat: OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::ChatTemplateKwargs,
    },
};

const AGNES_25_PRO: LlmModel = LlmModel {
    id: "agnes-2.5-pro",
    label: "agnes-2.5-pro",
    family: AdapterFamily::OpenAiChatCompletions,
    base_url: "https://api.agnes-ai.cn/v1",
    supports_thinking: true,
    openai_chat: OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::ChatTemplateKwargs,
    },
};

const DEEPSEEK_MODELS: &[LlmModel] = &[DEEPSEEK_CHAT];
const AGNES_MODELS: &[LlmModel] = &[AGNES_25_FLASH, AGNES_20_FLASH, AGNES_25_PRO];

static DEEPSEEK_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Deepseek,
    api_key_env: "DEEPSEEK_API_KEY",
    models: DEEPSEEK_MODELS,
};

static AGNES_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Agnes,
    api_key_env: "AGNES_API_KEY",
    models: AGNES_MODELS,
};

pub fn provider(id: ProviderId) -> &'static ProviderEntry {
    match id {
        ProviderId::Deepseek => &DEEPSEEK_PROVIDER,
        ProviderId::Agnes => &AGNES_PROVIDER,
    }
}

pub fn all_providers() -> [&'static ProviderEntry; 2] {
    [&DEEPSEEK_PROVIDER, &AGNES_PROVIDER]
}

pub fn models_for(provider_id: ProviderId) -> &'static [LlmModel] {
    provider(provider_id).models()
}

pub fn get_model(provider_id: ProviderId, model_id: &str) -> Option<&'static LlmModel> {
    models_for(provider_id)
        .iter()
        .find(|model| model.id == model_id)
}

pub struct ResolveOverrides<'a> {
    pub base_url: Option<&'a str>,
    pub model_id: Option<&'a str>,
}

/// Provider defaults after catalog model and endpoint normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEndpoint {
    pub provider_id: ProviderId,
    pub model_id: String,
    pub family: AdapterFamily,
    pub base_url: String,
    pub openai_chat: OpenAiChatOptions,
}

/// One indivisible runtime provider fact, including credentials and adapter options.
#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedProviderConfig {
    pub provider_id: ProviderId,
    pub model: String,
    pub family: AdapterFamily,
    pub base_url: String,
    pub api_key: String,
    pub openai_chat: OpenAiChatOptions,
}

impl fmt::Debug for ResolvedProviderConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResolvedProviderConfig")
            .field("provider_id", &self.provider_id)
            .field("model", &self.model)
            .field("family", &self.family)
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .field("openai_chat", &self.openai_chat)
            .finish()
    }
}

/// Resolve `(provider, model)` into fixed adapter defaults without credentials.
pub fn resolve_endpoint(
    provider_id: ProviderId,
    overrides: ResolveOverrides<'_>,
) -> ResolvedEndpoint {
    let entry = provider(provider_id);
    let default_model = entry.default_model();
    let requested_model = overrides.model_id.unwrap_or(default_model.id);
    let catalog_model = get_model(provider_id, requested_model).unwrap_or(default_model);
    let base_url = normalize_base_url(overrides.base_url.unwrap_or(catalog_model.base_url));
    ResolvedEndpoint {
        provider_id,
        model_id: requested_model.to_owned(),
        family: catalog_model.family,
        base_url,
        openai_chat: catalog_model.openai_chat,
    }
}

pub struct ProviderOverrides<'a> {
    pub base_url: Option<&'a str>,
    pub model: Option<&'a str>,
    pub api_key: Option<&'a str>,
}

/// Resolve catalog defaults and attach host-supplied credentials.
pub fn resolve_provider_config(
    provider_id: ProviderId,
    overrides: ProviderOverrides<'_>,
) -> ResolvedProviderConfig {
    let endpoint = resolve_endpoint(
        provider_id,
        ResolveOverrides {
            base_url: overrides.base_url,
            model_id: overrides.model,
        },
    );
    ResolvedProviderConfig {
        provider_id,
        model: endpoint.model_id,
        family: endpoint.family,
        base_url: endpoint.base_url,
        api_key: overrides.api_key.unwrap_or_default().to_owned(),
        openai_chat: endpoint.openai_chat,
    }
}

/// Apply provider defaults for a host settings projection.
pub fn apply_provider_switch(
    provider_id: ProviderId,
    model_id: &mut String,
    base_url: &mut String,
    clear_api_key: bool,
    api_key: &mut String,
) {
    let endpoint = resolve_endpoint(
        provider_id,
        ResolveOverrides {
            base_url: None,
            model_id: None,
        },
    );
    *model_id = endpoint.model_id;
    *base_url = endpoint.base_url;
    if clear_api_key {
        api_key.clear();
    }
}

fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/').to_owned();
    trimmed
        .strip_suffix("/chat/completions")
        .map(str::to_owned)
        .unwrap_or(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: every declared provider exposes a non-empty owned model slice.
    // Expected: defaults belong to their provider slice and use the supported OpenAI family.
    // Invariant: provider completeness is expressed without lookup panics.
    #[test]
    fn catalog_covers_declared_providers_and_models() {
        for entry in all_providers() {
            assert!(!entry.api_key_env().is_empty());
            assert!(!entry.models().is_empty());
            assert!(get_model(entry.id(), entry.default_model_id()).is_some());
            assert!(entry
                .models()
                .iter()
                .all(|model| model.family == AdapterFamily::OpenAiChatCompletions));
        }
    }

    // Scenario: Agnes endpoint resolves without host overrides.
    // Expected: model, base URL, and chat-template option come from the Agnes catalog.
    // Invariant: concrete vendor facts remain outside agent-core.
    #[test]
    fn resolve_agnes_defaults_from_catalog_model() {
        let endpoint = resolve_endpoint(
            ProviderId::Agnes,
            ResolveOverrides {
                base_url: None,
                model_id: None,
            },
        );
        assert_eq!(endpoint.model_id, "agnes-2.5-flash");
        assert_eq!(endpoint.base_url, "https://api.agnes-ai.cn/v1");
        assert_eq!(
            endpoint.openai_chat.thinking_extension,
            OpenAiThinkingExtension::ChatTemplateKwargs
        );
    }

    // Scenario: an explicit custom model id is supplied for Agnes.
    // Expected: the model id is preserved while provider defaults supply family and wire options.
    // Invariant: an explicit host override is never silently rewritten to a catalog default.
    #[test]
    fn custom_model_is_preserved_with_provider_defaults() {
        let endpoint = resolve_endpoint(
            ProviderId::Agnes,
            ResolveOverrides {
                base_url: None,
                model_id: Some("custom-model"),
            },
        );
        assert_eq!(endpoint.model_id, "custom-model");
        assert_eq!(
            endpoint.openai_chat.thinking_extension,
            OpenAiThinkingExtension::ChatTemplateKwargs
        );
    }

    // Scenario: ProviderId parsing receives an unsupported label.
    // Expected: parsing returns an explicit error.
    // Invariant: only exhaustively mapped provider identities enter the catalog.
    #[test]
    fn provider_id_parse_rejects_unknown_values() {
        assert!(ProviderId::parse("openrouter").is_err());
    }
}
