use agent::llm::{
    catalog_preset,
    list_provider_ids,
    models_for,
    provider,
    AdapterFamily,
    ProviderId,
    ResolvedEndpoint,
};
use agent::{
    Agent,
    ThinkingLevel,
};
use anyhow::{
    bail,
    Result,
};

use crate::args::CliArgs;
use crate::config::resolve_agent_config;
use crate::fuzzy::fuzzy_filter;
use crate::settings::{
    apply_provider_switch_in_store,
    format_api_key,
    load_persisted_global_config_store,
    persist_global_config_store,
    ApprovalPolicy,
    GlobalConfigStore,
    TraceMode,
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
    Provider,
    ThinkingLevel,
    Protocol,
    Profile,
    Trace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SettingApplyEffect {
    ReadOnly,
    NextTurn,
    ReloadAgent,
}

type SettingSyncFn = fn(&str, &mut GlobalConfigStore) -> Result<()>;

type ProviderRefreshFn = fn(
    entry: &mut SettingEntry,
    provider_id: ProviderId,
    preset: &ResolvedEndpoint,
    model_values: &[String],
);

pub(crate) struct SettingEntry {
    pub(crate) id: SettingId,
    pub(crate) label: &'static str,
    pub(crate) description: &'static str,
    pub(crate) current_value: String,
    pub(crate) values: Option<Vec<String>>,
    pub(crate) apply: SettingApplyEffect,
    sync: SettingSyncFn,
    provider_refresh: Option<ProviderRefreshFn>,
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
            SettingId::Protocol => "protocol",
            SettingId::Profile => "profile",
            SettingId::Provider => "provider",
            SettingId::ThinkingLevel => "thinking-level",
            SettingId::Trace => "trace",
        }
    }
}

pub(crate) struct SettingCatalog {
    entries: Vec<SettingEntry>,
}

impl SettingCatalog {
    pub(crate) fn from_runtime(settings: &GlobalConfigStore, agent: &Agent) -> Result<Self> {
        let provider_values = list_provider_ids()
            .iter()
            .map(|provider_id| provider_id.as_str().to_string())
            .collect();
        let model_values = models_for(settings.provider.clone())?
            .iter()
            .map(|option| option.id.to_owned())
            .collect();
        let protocol_values = provider(settings.provider.clone())?
            .supported_protocols()
            .iter()
            .map(|protocol| protocol.as_str().to_string())
            .collect();
        Ok(Self {
            entries: vec![
                SettingEntry {
                    id: SettingId::Provider,
                    label: "Provider",
                    description: "LLM provider preset",
                    current_value: provider_label(settings.provider.clone()),
                    values: Some(provider_values),
                    apply: SettingApplyEffect::ReloadAgent,
                    sync: sync_provider,
                    provider_refresh: Some(refresh_provider_label),
                },
                SettingEntry {
                    id: SettingId::Model,
                    label: "Model",
                    description: "Model name sent to the provider",
                    current_value: settings.model.clone(),
                    values: Some(model_values),
                    apply: SettingApplyEffect::ReloadAgent,
                    sync: sync_model,
                    provider_refresh: Some(refresh_model_from_preset),
                },
                SettingEntry {
                    id: SettingId::BaseUrl,
                    label: "Base URL",
                    description: "OpenAI-compatible endpoint root",
                    current_value: settings.base_url.clone(),
                    values: None,
                    apply: SettingApplyEffect::ReloadAgent,
                    sync: sync_base_url,
                    provider_refresh: Some(refresh_base_url_from_preset),
                },
                SettingEntry {
                    id: SettingId::Protocol,
                    label: "Protocol",
                    description: "Wire protocol adapter family",
                    current_value: settings
                        .protocol
                        .map(|protocol| protocol.as_str().to_string())
                        .unwrap_or_else(|| "catalog default".into()),
                    values: Some(protocol_values),
                    apply: SettingApplyEffect::ReloadAgent,
                    sync: sync_protocol,
                    provider_refresh: Some(refresh_protocol_from_preset),
                },
                SettingEntry {
                    id: SettingId::Profile,
                    label: "Profile",
                    description: "User protocol profile override persisted in settings.json",
                    current_value: if settings.profile.is_some() {
                        "custom".into()
                    } else {
                        "catalog default".into()
                    },
                    values: None,
                    apply: SettingApplyEffect::ReadOnly,
                    sync: sync_noop,
                    provider_refresh: None,
                },
                SettingEntry {
                    id: SettingId::ApiKey,
                    label: "API key",
                    description: "Provider API key for this process (masked)",
                    current_value: format_api_key(&settings.api_key, settings.provider.clone()),
                    values: None,
                    apply: SettingApplyEffect::ReadOnly,
                    sync: sync_noop,
                    provider_refresh: Some(refresh_clear_api_key),
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
                    sync: sync_approval_policy,
                    provider_refresh: None,
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
                    sync: sync_trace,
                    provider_refresh: None,
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
                    sync: sync_thinking_level,
                    provider_refresh: None,
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
                    sync: sync_max_steps,
                    provider_refresh: None,
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
                    sync: sync_max_tokens,
                    provider_refresh: None,
                },
                SettingEntry {
                    id: SettingId::Cwd,
                    label: "Working directory",
                    description: "Session working directory and Project Instructions root",
                    current_value: agent.cwd().display().to_string(),
                    values: None,
                    apply: SettingApplyEffect::ReadOnly,
                    sync: sync_noop,
                    provider_refresh: None,
                },
            ],
        })
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
        let (id, effect, next_value) = {
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
            entry.current_value = next_value.clone();
            (entry.id, entry.apply, next_value)
        };
        if id == SettingId::Provider {
            self.refresh_provider_projection(parse_provider(&next_value)?)?;
        }
        Ok(Some(effect))
    }

    fn refresh_provider_projection(&mut self, provider_id: ProviderId) -> Result<()> {
        let preset = catalog_preset(provider_id.clone())?;
        let model_values = models_for(provider_id.clone())?
            .iter()
            .map(|model| model.id.to_owned())
            .collect::<Vec<_>>();
        let protocol_values = provider(provider_id.clone())?
            .supported_protocols()
            .iter()
            .map(|protocol| protocol.as_str().to_string())
            .collect::<Vec<_>>();
        for entry in &mut self.entries {
            if let Some(refresh) = entry.provider_refresh {
                refresh(entry, provider_id.clone(), &preset, &model_values);
            }
            if entry.id == SettingId::Protocol {
                entry.values = Some(protocol_values.clone());
                entry.current_value = preset.protocol.as_str().to_string();
            }
        }
        Ok(())
    }

    pub(crate) fn sync_to_runtime(&self, settings: &mut GlobalConfigStore) -> Result<()> {
        for entry in &self.entries {
            (entry.sync)(&entry.current_value, settings)?;
        }
        Ok(())
    }
}

pub(crate) async fn apply_setting_change(
    effect: SettingApplyEffect,
    previous_settings: &GlobalConfigStore,
    settings: &mut GlobalConfigStore,
    agent: &mut Agent,
    args: &CliArgs,
) -> Result<()> {
    if matches!(effect, SettingApplyEffect::ReadOnly) {
        return Ok(());
    }

    persist_global_config_store(args, settings)?;
    let apply_result = match effect {
        SettingApplyEffect::NextTurn => agent.apply_turn_limits(
            settings.max_steps,
            settings.max_tokens,
            settings.thinking_level,
        ),
        SettingApplyEffect::ReloadAgent => {
            reload_agent_from_persisted_store(args, settings, agent).await
        }
        SettingApplyEffect::ReadOnly => Ok(()),
    };
    if let Err(error) = apply_result {
        if let Err(restore_error) = persist_global_config_store(args, previous_settings) {
            return Err(error.context(format!(
                "restore settings file after applying runtime settings failed: {restore_error:#}"
            )));
        }
        return Err(error);
    }
    Ok(())
}

pub(crate) async fn reload_agent_from_persisted_store(
    args: &CliArgs,
    settings: &mut GlobalConfigStore,
    agent: &mut Agent,
) -> Result<()> {
    let input_owner = settings.input_owner.clone();
    let mut reloaded = load_persisted_global_config_store(args)?;
    reloaded.input_owner = input_owner;
    let config = resolve_agent_config(args, &reloaded)?;
    agent.reload(config).await?;
    *settings = reloaded;
    Ok(())
}

pub(crate) fn apply_status_message(effect: SettingApplyEffect) -> &'static str {
    match effect {
        SettingApplyEffect::ReadOnly => "read-only",
        SettingApplyEffect::NextTurn => "applied on next turn",
        SettingApplyEffect::ReloadAgent => "agent reloaded",
    }
}

fn cycle_values(current: &str, defaults: &[&str]) -> Vec<String> {
    let mut values: Vec<String> = defaults.iter().map(|value| (*value).into()).collect();
    if !values.iter().any(|value| value == current) {
        values.push(current.into());
    }
    values
}

fn sync_noop(_value: &str, _settings: &mut GlobalConfigStore) -> Result<()> {
    Ok(())
}

fn sync_provider(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    let next = parse_provider(value)?;
    if next != settings.provider {
        apply_provider_switch_in_store(next, settings, true)?;
    }
    Ok(())
}

fn sync_protocol(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    if value == "catalog default" {
        settings.protocol = None;
        return Ok(());
    }
    settings.protocol = Some(
        AdapterFamily::parse(value)
            .ok_or_else(|| anyhow::anyhow!("unknown protocol label: {value}"))?,
    );
    Ok(())
}

fn sync_model(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.model = value.to_owned();
    Ok(())
}

fn sync_base_url(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.base_url = value.to_owned();
    Ok(())
}

fn sync_approval_policy(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.approval_policy = parse_approval(value)?;
    Ok(())
}

fn sync_trace(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.trace_mode = parse_trace(value)?;
    Ok(())
}

fn sync_thinking_level(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.thinking_level = parse_thinking(value)?;
    Ok(())
}

fn sync_max_steps(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.max_steps = value
        .parse()
        .map_err(|_| anyhow::anyhow!("invalid max steps value: {value}"))?;
    Ok(())
}

fn sync_max_tokens(value: &str, settings: &mut GlobalConfigStore) -> Result<()> {
    settings.max_tokens = value
        .parse()
        .map_err(|_| anyhow::anyhow!("invalid max tokens value: {value}"))?;
    Ok(())
}

fn refresh_provider_label(
    entry: &mut SettingEntry,
    provider_id: ProviderId,
    _preset: &ResolvedEndpoint,
    _model_values: &[String],
) {
    entry.current_value = provider_label(provider_id).to_owned();
}

fn refresh_model_from_preset(
    entry: &mut SettingEntry,
    _provider_id: ProviderId,
    preset: &ResolvedEndpoint,
    model_values: &[String],
) {
    entry.current_value = preset.model_id.clone();
    entry.values = Some(model_values.to_owned());
}

fn refresh_base_url_from_preset(
    entry: &mut SettingEntry,
    _provider_id: ProviderId,
    preset: &ResolvedEndpoint,
    _model_values: &[String],
) {
    entry.current_value = preset.base_url.clone();
}

fn refresh_clear_api_key(
    entry: &mut SettingEntry,
    _provider_id: ProviderId,
    _preset: &ResolvedEndpoint,
    _model_values: &[String],
) {
    entry.current_value = "(empty)".into();
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

fn refresh_protocol_from_preset(
    entry: &mut SettingEntry,
    _provider_id: ProviderId,
    preset: &ResolvedEndpoint,
    _model_values: &[String],
) {
    entry.current_value = preset.protocol.as_str().to_string();
}

fn provider_label(provider_id: ProviderId) -> String {
    provider_id.as_str().into_owned()
}

fn parse_provider(value: &str) -> Result<ProviderId> {
    ProviderId::parse(value)
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

#[cfg(test)]
mod tests {
    use clap::Parser;
    use tempfile::tempdir;

    use super::*;
    use crate::settings::persist_global_config_store;

    // Scenario: catalog excludes session id, runs dir, and tool list settings.
    // Expected: only user-facing agent settings appear in the catalog.
    // Invariant: session identity and extension-owned tools stay outside settings.
    #[tokio::test]
    async fn catalog_excludes_session_tools_and_runs_dir() {
        let mut args = <CliArgs as Parser>::parse_from(["moontide"]);
        let directory = tempdir().expect("temporary CLI settings directory");
        args.cwd = Some(directory.path().to_owned());
        let mut settings =
            crate::settings::load_global_config_store(&args).expect("global config store");
        settings.api_key = "secret".into();
        let config = resolve_agent_config(&args, &settings).expect("config");
        let agent = Agent::create(config).expect("agent");
        let catalog = SettingCatalog::from_runtime(&settings, &agent).expect("catalog");
        let labels: Vec<_> = catalog.entries().iter().map(|entry| entry.label).collect();
        assert!(!labels.iter().any(|label| label.contains("session id")));
        assert!(!labels.iter().any(|label| label.contains("runs")));
        assert!(!labels.iter().any(|label| label.contains("tools")));
    }

    // Scenario: settings file changes after the in-memory runtime store was loaded.
    // Expected: reload reads persisted values without applying stale CLI overrides.
    // Invariant: reload updates the runtime store from the settings file.
    #[tokio::test]
    async fn reload_preserves_runtime_settings_over_cli_overrides() {
        let mut args = <CliArgs as Parser>::parse_from([
            "moontide",
            "--cwd",
            "/tmp",
            "--provider",
            "agnes",
            "--model",
            "agnes-2.5-flash",
            "--base-url",
            "https://cli.example",
        ]);
        let directory = tempdir().expect("temporary CLI settings directory");
        args.cwd = Some(directory.path().to_owned());
        let mut settings =
            crate::settings::load_global_config_store(&args).expect("global config store");
        settings.api_key = "secret".into();
        settings.provider = ProviderId::Agnes;
        settings.model = "agnes-2.0-flash".into();
        settings.base_url = "https://runtime.example".into();
        persist_global_config_store(&args, &settings).expect("runtime settings should persist");

        let config = resolve_agent_config(&args, &settings).expect("agent config");
        let mut agent = Agent::create(config).expect("agent should bootstrap");

        let mut externally_updated = settings.clone();
        externally_updated.model = "agnes-2.5-pro".into();
        externally_updated.base_url = "https://external.example".into();
        persist_global_config_store(&args, &externally_updated)
            .expect("external settings update should persist");

        reload_agent_from_persisted_store(&args, &mut settings, &mut agent)
            .await
            .expect("agent should reload from persisted settings");

        assert_eq!(settings.model, "agnes-2.5-pro");
        assert_eq!(settings.base_url, "https://external.example");
    }

    // Scenario: cycling Provider in the production-shaped settings catalog.
    // Expected: Provider, Model, and Base URL entries refresh to Agnes while runtime key clears.
    // Invariant: stale DeepSeek projections cannot overwrite the provider-switch defaults.
    #[tokio::test]
    async fn sync_provider_switch_refreshes_full_catalog_and_runtime() {
        let directory = tempdir().expect("temporary CLI settings directory");
        let args = <CliArgs as Parser>::parse_from([
            "moontide",
            "--cwd",
            directory.path().to_str().expect("UTF-8 temp path"),
        ]);
        let mut settings =
            crate::settings::load_global_config_store(&args).expect("global config store");
        settings.api_key = "deepseek-key".into();
        let config = resolve_agent_config(&args, &settings).expect("agent config");
        let agent = Agent::create(config).expect("agent");
        let mut catalog = SettingCatalog::from_runtime(&settings, &agent).expect("catalog");
        let filtered = catalog.filter_indices("provider");
        assert_eq!(filtered.len(), 1);
        assert_eq!(
            catalog.cycle_value(0, &filtered).expect("cycle provider"),
            Some(SettingApplyEffect::ReloadAgent)
        );
        catalog
            .sync_to_runtime(&mut settings)
            .expect("sync provider");

        assert_eq!(settings.provider, ProviderId::Agnes);
        assert_eq!(settings.model, "agnes-2.5-flash");
        assert_eq!(settings.base_url, "https://api.agnes-ai.cn/v1");
        assert!(settings.api_key.is_empty());
        let model = catalog
            .entries()
            .iter()
            .find(|entry| entry.id == SettingId::Model)
            .expect("model entry");
        assert_eq!(model.current_value, "agnes-2.5-flash");
        assert_eq!(
            model.values.as_ref().expect("model values"),
            &vec![
                "agnes-2.5-flash".to_owned(),
                "agnes-2.0-flash".to_owned(),
                "agnes-2.5-pro".to_owned(),
            ]
        );
        let base_url = catalog
            .entries()
            .iter()
            .find(|entry| entry.id == SettingId::BaseUrl)
            .expect("base URL entry");
        assert_eq!(base_url.current_value, "https://api.agnes-ai.cn/v1");
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
