//! Host-facing LLM provider catalog, startup config merge, and resolution.
//!
//! Concrete provider/model tables live here; `agent-core` remains provider-neutral.

mod catalog;
mod credentials;
mod profile;
mod provider_id;
mod startup;

pub use agent_core::llm::adapter_family::AdapterFamily;
pub use agent_core::llm::normalize::openai_chat::{
    OpenAiChatOptions,
    OpenAiThinkingExtension,
};
pub use agent_core::llm::profile_config::{
    ContinuityHint,
    HostProtocolProfileOverride,
    ProtocolFeatureConfig,
    ProtocolFeatureConfigPatch,
    ProtocolFeatureSet,
    UserProtocolProfileOverride,
};
pub use agent_core::model_input::LlmCallConfig;
pub use catalog::{
    all_providers,
    apply_provider_switch,
    custom_provider_entries,
    get_model,
    list_provider_ids,
    models_for,
    provider,
    register_custom_providers,
    resolve_endpoint,
    resolve_provider_config,
    CustomProviderDefinition,
    LlmModel,
    ProviderEntry,
    ProviderOverrides,
    ResolveOverrides,
    ResolvedEndpoint,
    ResolvedProviderConfig,
};
pub use credentials::{
    api_key_env,
    read_api_key_from_env,
    require_api_key_from_env,
};
pub use profile::{
    merge_protocol_profile,
    ProviderProtocolProfileDefault,
};
pub use provider_id::ProviderId;
pub use startup::{
    catalog_preset,
    merge_startup_llm_config,
    read_llm_env,
    require_api_key,
    resolve_api_key_source,
    ApiKeySource,
    EnvSource,
    LlmConfigLayer,
    LlmEnvLayer,
    ProcessEnv,
};

#[cfg(test)]
mod tests;
