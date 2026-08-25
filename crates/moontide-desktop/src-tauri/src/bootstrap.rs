use std::{collections::BTreeMap, env};

use agent::{
    platform::ProjectPaths, AdapterFamily, AgentConfig, PersistenceConfig, ProviderConfig,
    SessionPersistence, ToolPermission, ToolPermissionMap,
};
use anyhow::{Context, Result};
use desktop::{DesktopProtocolConfig, DesktopProtocolServer};

use crate::{
    protocol_client::{DesktopProtocolClient, DesktopProtocolClientEventStream},
    transport::connect_in_process,
};

const API_KEY_ENV: &str = "DEEPSEEK_API_KEY";
const DEFAULT_MODEL: &str = "deepseek-chat";
const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_MAX_TOKENS: u32 = 4_096;
const DEFAULT_MAX_STEPS: u32 = 8;
const DEFAULT_EVENT_CAPACITY: usize = 256;
const DEFAULT_TRANSPORT_CAPACITY: usize = 256;

pub(crate) struct DesktopRuntime {
    pub(crate) client: DesktopProtocolClient,
    pub(crate) events: DesktopProtocolClientEventStream,
}

pub(crate) async fn start_runtime() -> Result<DesktopRuntime> {
    dotenvy::dotenv().ok();
    let config = DesktopProtocolConfig {
        agent: build_agent_config()?,
        event_capacity: DEFAULT_EVENT_CAPACITY,
    };
    let (server, server_events) =
        DesktopProtocolServer::start(config).context("start Desktop protocol server")?;
    let transport = connect_in_process(server, server_events, DEFAULT_TRANSPORT_CAPACITY)
        .context("start in-process Desktop transport")?;
    let (client, events) = DesktopProtocolClient::start(transport, DEFAULT_EVENT_CAPACITY)
        .context("start Desktop protocol client")?;
    Ok(DesktopRuntime { client, events })
}

fn build_agent_config() -> Result<AgentConfig> {
    let api_key = env::var(API_KEY_ENV)
        .with_context(|| format!("{API_KEY_ENV} is required for MoonTide Desktop"))?;
    if api_key.trim().is_empty() {
        anyhow::bail!("{API_KEY_ENV} must not be empty");
    }

    let cwd = env::current_dir().context("resolve current working directory")?;
    let paths = ProjectPaths::resolve(cwd, None, None)?;
    let (tool_names, permissions) = coding_preset();

    Ok(AgentConfig {
        cwd: paths.cwd,
        sessions_dir: paths.sessions_dir,
        runs_dir: paths.runs_dir,
        provider: ProviderConfig {
            family: AdapterFamily::OpenAiChatCompletions,
            base_url: DEFAULT_BASE_URL.to_owned(),
            api_key,
        },
        model: DEFAULT_MODEL.to_owned(),
        max_tokens: DEFAULT_MAX_TOKENS,
        thinking_level: None,
        max_steps: DEFAULT_MAX_STEPS,
        tool_names,
        permissions,
        approval: None,
        progress: None,
        persistence: PersistenceConfig {
            session: SessionPersistence::Items,
            diagnostic: agent::DiagnosticPersistence::Off,
        },
    })
}

fn coding_preset() -> (Vec<String>, ToolPermissionMap) {
    let allow = ["read", "find", "grep"];
    let ask = ["write", "edit", "bash"];
    let tool_names = allow
        .iter()
        .chain(ask.iter())
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let mut permissions = BTreeMap::new();
    for name in allow {
        permissions.insert(name.to_owned(), ToolPermission::Allow);
    }
    for name in ask {
        permissions.insert(name.to_owned(), ToolPermission::Ask);
    }
    (tool_names, permissions)
}
