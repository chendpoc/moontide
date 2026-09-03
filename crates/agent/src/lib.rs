//! MoonTide's composition root for one persistent agent session.

mod agent;
mod bootstrap;
mod coding_preset;
mod config;
mod log;
mod progress;
mod prompt;

pub mod llm;
pub mod platform;
pub mod session;

pub use agent::Agent;
pub use agent_core::event::{
    LlmCallFailureKind,
    LlmCallOutcome,
};
pub use agent_core::llm::protocol::{
    ContentBlock,
    ModelResponse,
    ModelResponseSnapshot,
    PendingBlock,
    StopReason,
    ThinkingLevel,
};
pub use agent_core::r#loop::{
    ToolApproval,
    ToolApprovalHandler,
    ToolPermission,
    ToolPermissionMap,
};
pub use agent_core::tools::{
    ToolCall,
    ToolResult,
};
pub use coding_preset::{
    resolve_coding_preset,
    CodingPresetPolicy,
    CODING_PRESET_EXCLUDED,
};
pub use config::{
    AgentConfig,
    DiagnosticPersistence,
    PersistenceConfig,
    ProgressObserver,
    SessionPersistence,
};
pub use llm::{
    all_providers,
    api_key_env,
    apply_provider_switch,
    catalog_preset,
    custom_provider_entries,
    get_model,
    list_provider_ids,
    merge_startup_llm_config,
    models_for,
    provider,
    read_api_key_from_env,
    read_llm_env,
    register_custom_providers,
    require_api_key,
    require_api_key_from_env,
    resolve_endpoint,
    resolve_provider_config,
    AdapterFamily,
    ContinuityHint,
    CustomProviderDefinition,
    EnvSource,
    LlmCallConfig,
    LlmConfigLayer,
    LlmEnvLayer,
    LlmModel,
    OpenAiChatOptions,
    OpenAiThinkingExtension,
    ProcessEnv,
    ProviderEntry,
    ProviderId,
    ProviderOverrides,
    ResolveOverrides,
    ResolvedEndpoint,
    ResolvedProviderConfig,
};
pub use log::{
    AgentEventLogHandle,
    AgentEventLogState,
    AgentEventLogStatus,
};
pub use progress::{
    ProgressEvent,
    ProgressHandle,
    ProgressStatus,
    ProgressWorkerState,
};
pub use session::{
    latest_session_id,
    SessionItem,
    SessionQuery,
    SessionSnapshot,
    SessionSummary,
    SessionTurnPage,
};

#[cfg(test)]
mod tests;
