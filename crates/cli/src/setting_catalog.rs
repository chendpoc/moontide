use agent::{Agent, ThinkingLevel};
use anyhow::{bail, Result};

use crate::{
    args::CliArgs,
    config::{resolve_agent_config, DEFAULT_MAX_STEPS, DEFAULT_MAX_TOKENS},
    fuzzy::fuzzy_filter,
    settings::{format_api_key, ApprovalPolicy, RuntimeSettings, TraceMode},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SettingId {
    ApiKey,
    ApprovalPolicy,
    BaseUrl,
    Cwd,
    MaxSteps,
    MaxTokens,
    Model,
    QuietStartup,
    ThinkingLevel,
    Trace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SettingApplyEffect {
    ReadOnly,
    NextTurn,
    ReloadAgent,
    NextLaunch,
}

pub(crate) struct SettingEntry {
    pub(crate) id: SettingId,
    pub(crate) label: &'static str,
    pub(crate) description: &'static str,
    pub(crate) current_value: String,
    pub(crate) values: Option<Vec<String>>,
    pub(crate) apply: SettingApplyEffect,
}

impl SettingEntry {
    pub(crate) fn searchable_text(&self) -> String {
        format!("{} {}", self.label, self.id_as_str())
    }

    fn id_as_str(&self) -> &'static str {
        match self.id {
            SettingId::ApiKey => "api-key",
            SettingId::ApprovalPolicy => "approval-policy",
            SettingId::BaseUrl => "base-url",
            SettingId::Cwd => "cwd",
            SettingId::MaxSteps => "max-steps",
            SettingId::MaxTokens => "max-tokens",
            SettingId::Model => "model",
            SettingId::QuietStartup => "quiet-startup",
            SettingId::ThinkingLevel => "thinking-level",
            SettingId::Trace => "trace",
        }
    }
}

pub(crate) struct SettingCatalog {
    entries: Vec<SettingEntry>,
}

impl SettingCatalog {
    pub(crate) fn from_runtime(settings: &RuntimeSettings, agent: &Agent) -> Self {
        Self {
            entries: vec![
                SettingEntry {
                    id: SettingId::Model,
                    label: "Model",
                    description: "Model name sent to the provider",
                    current_value: settings.model.clone(),
                    values: None,
                    apply: SettingApplyEffect::ReloadAgent,
                },
                SettingEntry {
                    id: SettingId::BaseUrl,
                    label: "Base URL",
                    description: "OpenAI-compatible endpoint root",
                    current_value: settings.base_url.clone(),
                    values: None,
                    apply: SettingApplyEffect::ReloadAgent,
                },
                SettingEntry {
                    id: SettingId::ApiKey,
                    label: "API key",
                    description: "DeepSeek API key for this process (masked)",
                    current_value: format_api_key(&settings.api_key),
                    values: None,
                    apply: SettingApplyEffect::ReadOnly,
                },
                SettingEntry {
                    id: SettingId::ApprovalPolicy,
                    label: "Approval policy",
                    description: "Tool permission posture for the coding preset",
                    current_value: approval_label(settings.approval_policy).to_owned(),
                    values: Some(vec![
                        "always ask".into(),
                        "coding defaults".into(),
                        "always allow".into(),
                    ]),
                    apply: SettingApplyEffect::ReloadAgent,
                },
                SettingEntry {
                    id: SettingId::Trace,
                    label: "Trace",
                    description: "Progress events written to stderr during turns",
                    current_value: trace_label(settings.trace_mode).to_owned(),
                    values: Some(vec![
                        "off".into(),
                        "events".into(),
                        "events-thinking".into(),
                    ]),
                    apply: SettingApplyEffect::ReloadAgent,
                },
                SettingEntry {
                    id: SettingId::ThinkingLevel,
                    label: "Thinking level",
                    description: "Reasoning depth for thinking-capable models",
                    current_value: thinking_label(settings.thinking_level).to_owned(),
                    values: Some(vec![
                        "off".into(),
                        "low".into(),
                        "medium".into(),
                        "high".into(),
                    ]),
                    apply: SettingApplyEffect::NextTurn,
                },
                SettingEntry {
                    id: SettingId::MaxSteps,
                    label: "Max steps",
                    description: "Maximum model steps per user turn",
                    current_value: settings.max_steps.to_string(),
                    values: Some(cycle_values(
                        &settings.max_steps.to_string(),
                        &["4", "8", "12", "16"],
                    )),
                    apply: SettingApplyEffect::NextTurn,
                },
                SettingEntry {
                    id: SettingId::MaxTokens,
                    label: "Max tokens",
                    description: "Maximum output tokens per model step",
                    current_value: settings.max_tokens.to_string(),
                    values: Some(cycle_values(
                        &settings.max_tokens.to_string(),
                        &["2048", "4096", "8192"],
                    )),
                    apply: SettingApplyEffect::NextTurn,
                },
                SettingEntry {
                    id: SettingId::Cwd,
                    label: "Working directory",
                    description: "Session working directory and Project Instructions root",
                    current_value: agent.cwd().display().to_string(),
                    values: None,
                    apply: SettingApplyEffect::ReadOnly,
                },
                SettingEntry {
                    id: SettingId::QuietStartup,
                    label: "Quiet startup",
                    description: "Hide verbose startup output on the next CLI launch",
                    current_value: bool_label(settings.quiet_startup).to_owned(),
                    values: Some(vec!["false".into(), "true".into()]),
                    apply: SettingApplyEffect::NextLaunch,
                },
            ],
        }
    }

    pub(crate) fn entries(&self) -> &[SettingEntry] {
        &self.entries
    }

    pub(crate) fn filter_indices(&self, query: &str) -> Vec<usize> {
        fuzzy_filter(&self.entries, query, |entry| entry.searchable_text())
    }

    pub(crate) fn cycle_value(
        &mut self,
        filtered_index: usize,
        filtered_indices: &[usize],
    ) -> Result<Option<SettingApplyEffect>> {
        let entry_index = *filtered_indices
            .get(filtered_index)
            .ok_or_else(|| anyhow::anyhow!("selected setting index out of range"))?;
        let entry = self
            .entries
            .get_mut(entry_index)
            .ok_or_else(|| anyhow::anyhow!("setting entry missing"))?;
        let Some(values) = entry.values.as_ref() else {
            return Ok(None);
        };
        if values.is_empty() {
            bail!("setting {} has no values to cycle", entry.label);
        }
        let current_index = values
            .iter()
            .position(|value| value == &entry.current_value)
            .unwrap_or(0);
        let next_value = values[(current_index + 1) % values.len()].clone();
        entry.current_value = next_value;
        Ok(Some(entry.apply))
    }

    pub(crate) fn sync_to_runtime(&self, settings: &mut RuntimeSettings) -> Result<()> {
        for entry in &self.entries {
            match entry.id {
                SettingId::Model => settings.model = entry.current_value.clone(),
                SettingId::BaseUrl => settings.base_url = entry.current_value.clone(),
                SettingId::ApprovalPolicy => {
                    settings.approval_policy = parse_approval(&entry.current_value)?;
                }
                SettingId::Trace => settings.trace_mode = parse_trace(&entry.current_value)?,
                SettingId::ThinkingLevel => {
                    settings.thinking_level = parse_thinking(&entry.current_value)?;
                }
                SettingId::MaxSteps => {
                    settings.max_steps = entry.current_value.parse().map_err(|_| {
                        anyhow::anyhow!("invalid max steps value: {}", entry.current_value)
                    })?;
                }
                SettingId::MaxTokens => {
                    settings.max_tokens = entry.current_value.parse().map_err(|_| {
                        anyhow::anyhow!("invalid max tokens value: {}", entry.current_value)
                    })?;
                }
                SettingId::QuietStartup => {
                    settings.quiet_startup = entry.current_value == "true";
                }
                SettingId::ApiKey | SettingId::Cwd => {}
            }
        }
        Ok(())
    }
}

pub(crate) fn apply_setting_change(
    effect: SettingApplyEffect,
    settings: &RuntimeSettings,
    agent: &mut Agent,
    args: &CliArgs,
) -> Result<()> {
    match effect {
        SettingApplyEffect::ReadOnly | SettingApplyEffect::NextLaunch => Ok(()),
        SettingApplyEffect::NextTurn => agent.apply_turn_limits(
            settings.max_steps,
            settings.max_tokens,
            settings.thinking_level,
        ),
        SettingApplyEffect::ReloadAgent => {
            let config = resolve_agent_config(args, settings)?;
            agent.reload(config)
        }
    }
}

pub(crate) fn apply_status_message(effect: SettingApplyEffect) -> &'static str {
    match effect {
        SettingApplyEffect::ReadOnly => "read-only",
        SettingApplyEffect::NextTurn => "applied on next turn",
        SettingApplyEffect::ReloadAgent => "agent reloaded",
        SettingApplyEffect::NextLaunch => "applies on next launch",
    }
}

fn cycle_values(current: &str, defaults: &[&str]) -> Vec<String> {
    let mut values: Vec<String> = defaults.iter().map(|value| (*value).into()).collect();
    if !values.iter().any(|value| value == current) {
        values.push(current.into());
    }
    values
}

fn approval_label(policy: ApprovalPolicy) -> &'static str {
    match policy {
        ApprovalPolicy::Default => "coding defaults",
        ApprovalPolicy::Always => "always ask",
        ApprovalPolicy::AlwaysAllow => "always allow",
    }
}

fn trace_label(mode: TraceMode) -> &'static str {
    match mode {
        TraceMode::Off => "off",
        TraceMode::Events => "events",
        TraceMode::EventsAndThinking => "events-thinking",
    }
}

fn thinking_label(level: Option<ThinkingLevel>) -> &'static str {
    match level {
        None | Some(ThinkingLevel::Off) => "off",
        Some(ThinkingLevel::Low) => "low",
        Some(ThinkingLevel::Medium) => "medium",
        Some(ThinkingLevel::High) => "high",
    }
}

fn bool_label(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn parse_approval(value: &str) -> Result<ApprovalPolicy> {
    match value {
        "always ask" => Ok(ApprovalPolicy::Always),
        "coding defaults" => Ok(ApprovalPolicy::Default),
        "always allow" => Ok(ApprovalPolicy::AlwaysAllow),
        other => bail!("unknown approval policy label: {other}"),
    }
}

fn parse_trace(value: &str) -> Result<TraceMode> {
    match value {
        "off" => Ok(TraceMode::Off),
        "events" => Ok(TraceMode::Events),
        "events-thinking" => Ok(TraceMode::EventsAndThinking),
        other => bail!("unknown trace label: {other}"),
    }
}

fn parse_thinking(value: &str) -> Result<Option<ThinkingLevel>> {
    match value {
        "off" => Ok(None),
        "low" => Ok(Some(ThinkingLevel::Low)),
        "medium" => Ok(Some(ThinkingLevel::Medium)),
        "high" => Ok(Some(ThinkingLevel::High)),
        other => bail!("unknown thinking level label: {other}"),
    }
}

pub(crate) fn initial_runtime_settings(args: &CliArgs, api_key: String) -> RuntimeSettings {
    RuntimeSettings {
        api_key,
        approval_policy: args.approval_policy.into(),
        trace_mode: args.trace.into(),
        model: args.model.clone(),
        base_url: args.base_url.clone(),
        max_tokens: DEFAULT_MAX_TOKENS,
        max_steps: DEFAULT_MAX_STEPS,
        thinking_level: None,
        quiet_startup: false,
        input_owner: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;
    use tempfile::tempdir;

    // Scenario: catalog excludes session id, runs dir, and tool list settings.
    // Expected: only user-facing agent settings appear in the catalog.
    // Invariant: session identity and extension-owned tools stay outside settings.
    #[test]
    fn catalog_excludes_session_tools_and_runs_dir() {
        let mut args = <CliArgs as Parser>::parse_from(["moontide"]);
        let directory = tempdir().expect("temporary CLI settings directory");
        args.cwd = Some(directory.path().to_owned());
        let settings = initial_runtime_settings(&args, "secret".into());
        let config = resolve_agent_config(&args, &settings).expect("config");
        let agent = Agent::create(config).expect("agent");
        let catalog = SettingCatalog::from_runtime(&settings, &agent);
        let labels: Vec<_> = catalog.entries().iter().map(|entry| entry.label).collect();
        assert!(!labels.iter().any(|label| label.contains("session id")));
        assert!(!labels.iter().any(|label| label.contains("runs")));
        assert!(!labels.iter().any(|label| label.contains("tools")));
    }

    // Scenario: a numeric setting has a value outside the standard cycle choices.
    // Expected: the current value is retained and the next choice is still reachable.
    // Invariant: opening Settings does not silently reset a valid runtime value.
    #[test]
    fn cycle_values_preserves_nonstandard_current_value() {
        let values = cycle_values("10", &["4", "8", "12"]);
        assert_eq!(values, vec!["4", "8", "12", "10"]);
    }
}
