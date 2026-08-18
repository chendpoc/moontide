use std::env;

use agent::ThinkingLevel;
use anyhow::{bail, Context, Result};

use crate::{
    args::{ApprovalPolicyArg, CliArgs, TraceModeArg},
    input::InputOwner,
    render::write_diagnostic_stderr,
    setting_catalog::initial_runtime_settings,
};

const API_KEY_ENV: &str = "DEEPSEEK_API_KEY";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ApprovalPolicy {
    Default,
    Always,
    AlwaysAllow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TraceMode {
    Off,
    Events,
    EventsAndThinking,
}

#[derive(Clone)]
pub(crate) struct RuntimeSettings {
    pub(crate) api_key: String,
    pub(crate) approval_policy: ApprovalPolicy,
    pub(crate) trace_mode: TraceMode,
    pub(crate) model: String,
    pub(crate) base_url: String,
    pub(crate) max_tokens: u32,
    pub(crate) max_steps: u32,
    pub(crate) thinking_level: Option<ThinkingLevel>,
    pub(crate) quiet_startup: bool,
    pub(crate) input_owner: Option<InputOwner>,
}

pub(crate) fn format_api_key(api_key: &str) -> String {
    if api_key.trim().is_empty() {
        return "(empty)".into();
    }
    if env::var(API_KEY_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_some_and(|value| value == api_key)
    {
        return "*** (env)".into();
    }
    "*** (runtime)".into()
}

pub(crate) fn resolve_one_shot(args: &CliArgs) -> Result<RuntimeSettings> {
    let api_key = env::var(API_KEY_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("{API_KEY_ENV} is required for one-shot mode"))?;
    Ok(initial_runtime_settings(args, api_key))
}

pub(crate) fn resolve_interactive(
    args: &CliArgs,
    input_owner: InputOwner,
) -> Result<RuntimeSettings> {
    write_diagnostic_stderr("MoonTide settings").context("write settings header")?;
    write_diagnostic_stderr(&format!(
        "cwd: {}\nsession: {}",
        args.cwd
            .as_deref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "current directory".into()),
        args.session.as_deref().unwrap_or("create new session")
    ))
    .context("write settings summary")?;

    let mut settings = initial_runtime_settings(args, String::new());
    settings.input_owner = Some(input_owner.clone());

    let api_key = match env::var(API_KEY_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        Some(api_key) => {
            write_diagnostic_stderr("DeepSeek API key: detected in environment")
                .context("write API key status")?;
            api_key
        }
        None => {
            write_diagnostic_stderr("DeepSeek API key not found; enter it (hidden input):")
                .context("write API key prompt")?;
            let api_key = input_owner.read_secret()?;
            if api_key.trim().is_empty() {
                bail!("DeepSeek API key must not be empty");
            }
            api_key
        }
    };
    settings.api_key = api_key;

    settings.approval_policy = choose_approval_policy(args.approval_policy, &input_owner)?;
    if matches!(settings.approval_policy, ApprovalPolicy::AlwaysAllow) {
        write_diagnostic_stderr(
            "WARNING: always-allow permits every enabled tool without approval. Type ALLOW to continue.",
        )
        .context("write always-allow warning")?;
        let confirmation = input_owner
            .readline("")
            .map_err(anyhow::Error::new)
            .context("read always-allow confirmation")?;
        if confirmation.trim() != "ALLOW" {
            bail!("always-allow confirmation was not provided");
        }
    }
    write_diagnostic_stderr("Press Enter to start, or type q to exit.")
        .context("write settings confirmation")?;
    let confirmation = input_owner
        .readline("")
        .map_err(anyhow::Error::new)
        .context("read settings confirmation")?;
    if confirmation.trim().eq_ignore_ascii_case("q") {
        bail!("startup cancelled from settings");
    }

    Ok(settings)
}

fn choose_approval_policy(
    default: ApprovalPolicyArg,
    input_owner: &InputOwner,
) -> Result<ApprovalPolicy> {
    write_diagnostic_stderr(&format!(
        "approval policy: [1] always ask  [2] coding defaults  [3] always allow (default: {})",
        policy_label(default.into())
    ))
    .context("write approval policy prompt")?;
    let selection = input_owner
        .readline("")
        .map_err(anyhow::Error::new)
        .context("read approval policy")?;
    match selection.trim() {
        "" => Ok(default.into()),
        "1" | "always" => Ok(ApprovalPolicy::Always),
        "2" | "default" => Ok(ApprovalPolicy::Default),
        "3" | "always-allow" => Ok(ApprovalPolicy::AlwaysAllow),
        _ => bail!("approval policy must be 1/always, 2/default, or 3/always-allow"),
    }
}

fn policy_label(policy: ApprovalPolicy) -> &'static str {
    match policy {
        ApprovalPolicy::Default => "coding defaults",
        ApprovalPolicy::Always => "always ask",
        ApprovalPolicy::AlwaysAllow => "always allow",
    }
}

impl From<ApprovalPolicyArg> for ApprovalPolicy {
    fn from(value: ApprovalPolicyArg) -> Self {
        match value {
            ApprovalPolicyArg::Default => Self::Default,
            ApprovalPolicyArg::Always => Self::Always,
            ApprovalPolicyArg::AlwaysAllow => Self::AlwaysAllow,
        }
    }
}

impl From<TraceModeArg> for TraceMode {
    fn from(value: TraceModeArg) -> Self {
        match value {
            TraceModeArg::Off => Self::Off,
            TraceModeArg::Events => Self::Events,
            TraceModeArg::EventsThinking => Self::EventsAndThinking,
        }
    }
}
