//! MoonTide's composition root for one persistent agent session.

mod agent;
mod bootstrap;
mod config;
mod log;
mod progress;
mod prompt;

pub mod llm;
pub mod platform;
pub mod session;

pub use agent::Agent;
pub use agent_core::{
    event::{LlmCallFailureKind, LlmCallOutcome},
    llm::protocol::{
        ContentBlock, ModelResponse, ModelResponseSnapshot, PendingBlock, StopReason, ThinkingLevel,
    },
    r#loop::{ToolApproval, ToolApprovalHandler, ToolPermission, ToolPermissionMap},
    tools::{ToolCall, ToolResult},
};
pub use config::ProgressObserver;
pub use config::{AgentConfig, DiagnosticPersistence, PersistenceConfig, SessionPersistence};
pub use log::{AgentEventLogHandle, AgentEventLogState, AgentEventLogStatus};
pub use progress::{ProgressEvent, ProgressHandle, ProgressStatus, ProgressWorkerState};

pub use llm::{
    all_providers, api_key_env, apply_provider_switch, catalog_preset, get_model,
    merge_startup_llm_config, models_for, provider, read_api_key_from_env, read_llm_env,
    require_api_key, require_api_key_from_env, resolve_endpoint, resolve_provider_config,
    AdapterFamily, EnvSource, LlmConfigLayer, LlmEnvLayer, LlmModel, OpenAiChatOptions,
    OpenAiThinkingExtension, ProcessEnv, ProviderEntry, ProviderId, ProviderOverrides,
    ResolveOverrides, ResolvedEndpoint, ResolvedProviderConfig,
};
pub use session::{latest_session_id, SessionItem, SessionQuery, SessionSnapshot, SessionSummary};

#[cfg(test)]
mod tests;
