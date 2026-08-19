use std::{collections::BTreeMap, env, path::PathBuf, sync::Arc};

use agent::{
    platform::ProjectPaths, AdapterFamily, AgentConfig, ToolApprovalHandler, ToolPermission,
    ToolPermissionMap,
};
use anyhow::{bail, Context, Result};

use crate::args::CliArgs;
use crate::{
    approval::{InteractiveApproval, NonInteractiveApproval},
    settings::{ApprovalPolicy, GlobalConfigStore, TraceMode},
    trace::TraceObserver,
};

pub(crate) const DEFAULT_MAX_TOKENS: u32 = 4_096;
pub(crate) const DEFAULT_MAX_STEPS: u32 = 8;
const API_KEY_ENV: &str = "DEEPSEEK_API_KEY";

pub(crate) fn resolve_agent_config(
    args: &CliArgs,
    settings: &GlobalConfigStore,
) -> Result<AgentConfig> {
    let cwd = args
        .cwd
        .clone()
        .map(Ok)
        .unwrap_or_else(env::current_dir)
        .context("resolve current working directory")?;
    resolve_agent_config_with(args, cwd, Some(settings.api_key.clone()), settings)
}

pub(crate) fn resolve_project_paths(args: &CliArgs) -> Result<ProjectPaths> {
    let cwd = args
        .cwd
        .clone()
        .map(Ok)
        .unwrap_or_else(env::current_dir)
        .context("resolve current working directory")?;
    ProjectPaths::resolve(cwd, args.sessions_dir.clone(), args.runs_dir.clone())
}

pub(crate) fn resolve_agent_config_with(
    args: &CliArgs,
    cwd: PathBuf,
    api_key: Option<String>,
    settings: &GlobalConfigStore,
) -> Result<AgentConfig> {
    let api_key = api_key
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("{API_KEY_ENV} is required"))?;
    let paths = ProjectPaths::resolve(cwd, args.sessions_dir.clone(), args.runs_dir.clone())?;

    let (tool_names, permissions) = coding_preset(settings.approval_policy);
    let approval: Option<Arc<dyn ToolApprovalHandler>> = match settings.approval_policy {
        ApprovalPolicy::AlwaysAllow => None,
        ApprovalPolicy::Default | ApprovalPolicy::Always => match settings.input_owner.clone() {
            Some(input_owner) => Some(Arc::new(InteractiveApproval::new(input_owner))),
            None => Some(Arc::new(NonInteractiveApproval)),
        },
    };
    let progress = match settings.trace_mode {
        TraceMode::Off => None,
        TraceMode::Events | TraceMode::EventsAndThinking => {
            Some(Arc::new(TraceObserver::new(settings.trace_mode))
                as Arc<dyn agent::ProgressObserver>)
        }
    };
    Ok(AgentConfig {
        cwd: paths.cwd,
        sessions_dir: paths.sessions_dir,
        runs_dir: paths.runs_dir,
        provider: agent::ProviderConfig {
            family: AdapterFamily::OpenAiChatCompletions,
            base_url: settings.base_url.clone(),
            api_key,
        },
        model: settings.model.clone(),
        max_tokens: settings.max_tokens,
        thinking_level: settings.thinking_level,
        max_steps: settings.max_steps,
        tool_names,
        permissions,
        approval,
        progress,
    })
}

fn coding_preset(policy: ApprovalPolicy) -> (Vec<String>, ToolPermissionMap) {
    let allow = ["read", "find", "grep"];
    let ask = ["write", "edit", "bash"];
    let tool_names = allow
        .iter()
        .chain(ask.iter())
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let mut permissions = BTreeMap::new();
    for name in allow {
        permissions.insert(
            name.to_owned(),
            match policy {
                ApprovalPolicy::Default => ToolPermission::Allow,
                ApprovalPolicy::Always => ToolPermission::Ask,
                ApprovalPolicy::AlwaysAllow => ToolPermission::Allow,
            },
        );
    }
    for name in ask {
        permissions.insert(
            name.to_owned(),
            match policy {
                ApprovalPolicy::AlwaysAllow => ToolPermission::Allow,
                ApprovalPolicy::Default | ApprovalPolicy::Always => ToolPermission::Ask,
            },
        );
    }
    (tool_names, permissions)
}

pub(crate) fn session_mode(args: &CliArgs) -> &'static str {
    if args.session.is_some() {
        "resume"
    } else {
        "create"
    }
}

pub(crate) fn validate_prompt(args: &CliArgs) -> Result<&str> {
    let prompt = args
        .prompt
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("one-shot mode requires --prompt"))?;
    if prompt.is_empty() {
        bail!("--prompt must not be empty");
    }
    Ok(prompt)
}
