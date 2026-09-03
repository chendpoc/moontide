use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use agent::llm::require_api_key;
use agent::platform::ProjectPaths;
use agent::{
    resolve_coding_preset,
    CodingPresetPolicy,
    ToolApprovalHandler,
};
use anyhow::{
    bail,
    Context,
    Result,
};

use crate::approval::{
    InteractiveApproval,
    NonInteractiveApproval,
};
use crate::args::CliArgs;
use crate::settings::{
    ApprovalPolicy,
    GlobalConfigStore,
    TraceMode,
};
use crate::trace::TraceObserver;

pub(crate) const DEFAULT_MAX_TOKENS: u32 = 4_096;
pub(crate) const DEFAULT_MAX_STEPS: u32 = 8;

pub(crate) fn resolve_agent_config(
    args: &CliArgs,
    settings: &GlobalConfigStore,
) -> Result<agent::AgentConfig> {
    let cwd = args
        .cwd
        .clone()
        .map(Ok)
        .unwrap_or_else(env::current_dir)
        .context("resolve current working directory")?;
    resolve_agent_config_with(args, cwd, settings)
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
    settings: &GlobalConfigStore,
) -> Result<agent::AgentConfig> {
    let merged = crate::settings::merged_llm_from_store(settings)?;
    require_api_key(&merged)?;
    let paths = ProjectPaths::resolve(cwd, args.sessions_dir.clone(), args.runs_dir.clone())?;

    let (tool_names, permissions) =
        resolve_coding_preset(CodingPresetPolicy::from(settings.approval_policy));
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
    Ok(agent::AgentConfig {
        cwd: paths.cwd,
        sessions_dir: paths.sessions_dir,
        runs_dir: paths.runs_dir,
        provider: merged,
        max_tokens: settings.max_tokens,
        thinking_level: settings.thinking_level,
        max_steps: settings.max_steps,
        tool_names,
        permissions,
        approval,
        progress,
        persistence: settings.persistence,
    })
}

impl From<ApprovalPolicy> for CodingPresetPolicy {
    fn from(value: ApprovalPolicy) -> Self {
        match value {
            ApprovalPolicy::Default => Self::Default,
            ApprovalPolicy::Always => Self::Always,
            ApprovalPolicy::AlwaysAllow => Self::AlwaysAllow,
        }
    }
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
