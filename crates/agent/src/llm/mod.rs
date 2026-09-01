//! Host-facing LLM provider catalog, startup config merge, and resolution.
//!
//! Concrete provider/model tables live here; `agent-core` remains provider-neutral.

mod catalog;
mod credentials;
mod startup;

pub use agent_core::llm::adapter::AdapterFamily;
pub use agent_core::llm::normalize::openai_chat::{OpenAiChatOptions, OpenAiThinkingExtension};
pub use catalog::{
    all_providers, apply_provider_switch, get_model, models_for, provider, resolve_endpoint,
    resolve_provider_config, LlmModel, ProviderEntry, ProviderId, ProviderOverrides,
    ResolveOverrides, ResolvedEndpoint, ResolvedProviderConfig,
};

pub use credentials::{api_key_env, read_api_key_from_env, require_api_key_from_env};
pub use startup::{
    catalog_preset, merge_startup_llm_config, read_llm_env, require_api_key,
    resolve_api_key_source, ApiKeySource, EnvSource, LlmConfigLayer, LlmEnvLayer, ProcessEnv,
};

#[cfg(test)]
mod tests;
