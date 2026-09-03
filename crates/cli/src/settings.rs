use std::collections::BTreeMap;
use std::path::Path;
use std::{
    env,
    fs,
};

use agent::llm::{
    AdapterFamily,
    ApiKeySource,
    CustomProviderDefinition,
    EnvSource,
    LlmConfigLayer,
    ProcessEnv,
    ProviderId,
    UserProtocolProfileOverride,
    api_key_env,
    apply_provider_switch,
    catalog_preset,
    merge_startup_llm_config,
    provider,
    read_llm_env,
    register_custom_providers,
    require_api_key,
    resolve_api_key_source,
};
use agent::{
    DiagnosticPersistence,
    PersistenceConfig,
    SessionPersistence,
    ThinkingLevel,
};
use anyhow::{
    Context,
    Result,
    bail,
};
use serde::{
    Deserialize,
    Serialize,
};

use crate::args::{
    ApprovalPolicyArg,
    CliArgs,
    TraceModeArg,
};
use crate::config::{
    DEFAULT_MAX_STEPS,
    DEFAULT_MAX_TOKENS,
    resolve_project_paths,
};
use crate::input::InputOwner;
use crate::render::write_diagnostic_stderr;

const SETTINGS_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ApprovalPolicy {
    Default,
    Always,
    AlwaysAllow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum TraceMode {
    Off,
    Events,
    EventsAndThinking,
}

/// Runtime-owned configuration. The settings file is loaded into this store only at
/// lifecycle boundaries; running settings mutations update this object directly.
#[derive(Clone)]
pub(crate) struct GlobalConfigStore {
    pub(crate) provider: ProviderId,
    pub(crate) api_key: String,
    pub(crate) approval_policy: ApprovalPolicy,
    pub(crate) trace_mode: TraceMode,
    pub(crate) model: String,
    pub(crate) base_url: String,
    pub(crate) protocol: Option<AdapterFamily>,
    pub(crate) profile: Option<UserProtocolProfileOverride>,
    pub(crate) custom_providers: BTreeMap<String, CustomProviderDefinition>,
    pub(crate) max_tokens: u32,
    pub(crate) max_steps: u32,
    pub(crate) thinking_level: Option<ThinkingLevel>,
    pub(crate) persistence: PersistenceConfig,
    pub(crate) input_owner: Option<InputOwner>,
}

#[derive(Clone, Serialize, Deserialize)]
struct PersistedSettings {
    version: u32,
    provider: ProviderId,
    api_key: String,
    approval_policy: ApprovalPolicy,
    trace_mode: TraceMode,
    model: String,
    base_url: String,
    #[serde(default)]
    protocol: Option<AdapterFamily>,
    #[serde(default)]
    profile: Option<UserProtocolProfileOverride>,
    #[serde(default)]
    custom_providers: BTreeMap<String, CustomProviderDefinition>,
    max_tokens: u32,
    max_steps: u32,
    thinking_level: Option<ThinkingLevel>,
    persistence: PersistenceConfig,
}

impl PersistedSettings {
    fn from_runtime(settings: &GlobalConfigStore) -> Self {
        Self {
            version: SETTINGS_VERSION,
            provider: settings.provider.clone(),
            api_key: settings.api_key.clone(),
            approval_policy: settings.approval_policy,
            trace_mode: settings.trace_mode,
            model: settings.model.clone(),
            base_url: settings.base_url.clone(),
            protocol: settings.protocol,
            profile: settings.profile.clone(),
            custom_providers: settings.custom_providers.clone(),
            max_tokens: settings.max_tokens,
            max_steps: settings.max_steps,
            thinking_level: settings.thinking_level,
            persistence: settings.persistence,
        }
    }

    fn apply_to(self, settings: &mut GlobalConfigStore) -> Result<()> {
        if self.version != SETTINGS_VERSION && self.version != 1 {
            bail!(
                "unsupported settings version {} (expected {} or 1)",
                self.version,
                SETTINGS_VERSION
            );
        }
        settings.provider = self.provider;
        settings.api_key = self.api_key;
        settings.approval_policy = self.approval_policy;
        settings.trace_mode = self.trace_mode;
        settings.model = self.model;
        settings.base_url = self.base_url;
        settings.protocol = self.protocol;
        settings.profile = self.profile;
        settings.custom_providers = self.custom_providers;
        settings.max_tokens = self.max_tokens;
        settings.max_steps = self.max_steps;
        settings.thinking_level = self.thinking_level;
        settings.persistence = self.persistence;
        Ok(())
    }

    fn to_llm_layer(&self) -> Result<LlmConfigLayer> {
        LlmConfigLayer::new(
            Some(self.provider.clone()),
            Some(self.model.clone()),
            Some(self.base_url.clone()),
            non_empty_api_key(&self.api_key),
            self.protocol,
            self.profile.clone(),
        )
        .context("construct settings LLM layer")
    }
}

fn non_empty_api_key(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

pub(crate) fn format_api_key(api_key: &str, provider_id: ProviderId) -> String {
    if api_key.trim().is_empty() {
        return "(empty)".into();
    }
    let Ok(env_name) = api_key_env(provider_id) else {
        return "*** (runtime)".into();
    };
    if env::var(env_name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_some_and(|value| value == api_key)
    {
        return format!("*** ({env_name})");
    }
    "*** (runtime)".into()
}

pub(crate) fn resolve_one_shot(args: &CliArgs) -> Result<GlobalConfigStore> {
    let settings = load_global_config_store(args)?;
    let merged = merged_llm_from_store(&settings)?;
    require_api_key(&merged).with_context(|| {
        format!(
            "API key is required for one-shot mode; provide --api-key, {}, or settings.json",
            api_key_env(settings.provider.clone()).unwrap_or("provider API key env")
        )
    })?;
    Ok(settings)
}

pub(crate) fn resolve_interactive(
    args: &CliArgs,
    input_owner: InputOwner,
) -> Result<GlobalConfigStore> {
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

    let mut settings = load_global_config_store(args)?;
    settings.input_owner = Some(input_owner.clone());
    let provider_label = provider(settings.provider.clone())?.id().label();
    let (_, settings_layer, env_layer, host_layer) = read_cli_llm_layers(args)?;
    let api_key_source = resolve_api_key_source(&settings_layer, &env_layer, &host_layer);

    if matches!(api_key_source, ApiKeySource::Missing) {
        write_diagnostic_stderr(&format!(
            "{provider_label} API key not found; enter it (hidden input):"
        ))
        .context("write API key prompt")?;
        settings.api_key = input_owner.read_secret()?;
        if !has_api_key(&settings.api_key) {
            bail!("{provider_label} API key must not be empty");
        }
    } else {
        let status = match api_key_source {
            ApiKeySource::Host => format!("{provider_label} API key: from --api-key"),
            ApiKeySource::Environment => format!(
                "{provider_label} API key: from {}",
                api_key_env(settings.provider.clone()).unwrap_or("provider API key env")
            ),
            ApiKeySource::Settings => {
                format!("{provider_label} API key: from settings.json")
            }
            ApiKeySource::Missing => unreachable!("missing key handled above"),
        };
        write_diagnostic_stderr(&status).context("write API key status")?;
    }

    settings.approval_policy =
        choose_approval_policy(approval_policy_arg(settings.approval_policy), &input_owner)?;
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
    write_diagnostic_stderr("Press Enter to start, or type /exit to cancel.")
        .context("write settings confirmation")?;
    let confirmation = input_owner
        .readline("")
        .map_err(anyhow::Error::new)
        .context("read settings confirmation")?;
    if confirmation.trim().eq_ignore_ascii_case("/exit") {
        bail!("startup cancelled from settings");
    }

    persist_global_config_store(args, &settings).context("persist confirmed startup settings")?;
    Ok(settings)
}

fn read_cli_llm_layers_with_env(
    args: &CliArgs,
    env: &impl EnvSource,
) -> Result<(
    agent::platform::ProjectPaths,
    LlmConfigLayer,
    agent::llm::LlmEnvLayer,
    LlmConfigLayer,
)> {
    validate_explicit_api_key(args)?;
    let paths = resolve_project_paths(args)?;
    let settings_layer = read_persisted_llm_layer(&paths.settings_path)?;
    let env_layer = read_llm_env(env)?;
    let host_layer = cli_host_llm_layer(args)?;
    Ok((paths, settings_layer, env_layer, host_layer))
}

fn read_cli_llm_layers(
    args: &CliArgs,
) -> Result<(
    agent::platform::ProjectPaths,
    LlmConfigLayer,
    agent::llm::LlmEnvLayer,
    LlmConfigLayer,
)> {
    read_cli_llm_layers_with_env(args, &ProcessEnv)
}

pub(crate) fn load_global_config_store(args: &CliArgs) -> Result<GlobalConfigStore> {
    load_global_config_store_with_env(args, &ProcessEnv)
}

fn load_global_config_store_with_env(
    args: &CliArgs,
    env: &impl EnvSource,
) -> Result<GlobalConfigStore> {
    let paths = resolve_project_paths(args)?;
    ensure_custom_providers_registered(&paths.settings_path)?;
    let (_, settings_layer, env_layer, host_layer) = read_cli_llm_layers_with_env(args, env)?;
    let mut store = default_non_llm_global_config_store()?;
    if paths.settings_path.exists() {
        let persisted = load_persisted_settings(&paths.settings_path)?;
        persisted.apply_to(&mut store)?;
    }
    let merged = merge_startup_llm_config(&settings_layer, &env_layer, &host_layer)?;
    apply_merged_llm(&mut store, &merged);
    apply_cli_non_llm_overrides(&mut store, args);
    Ok(store)
}

pub(crate) fn load_persisted_global_config_store(args: &CliArgs) -> Result<GlobalConfigStore> {
    let paths = resolve_project_paths(args)?;
    ensure_custom_providers_registered(&paths.settings_path)?;
    let mut store = default_non_llm_global_config_store()?;
    if paths.settings_path.exists() {
        let persisted = load_persisted_settings(&paths.settings_path)?;
        persisted.apply_to(&mut store)?;
    }
    let settings_layer = read_persisted_llm_layer(&paths.settings_path)?;
    let env_layer = read_llm_env(&ProcessEnv)?;
    let merged = merge_startup_llm_config(&settings_layer, &env_layer, &LlmConfigLayer::default())?;
    apply_merged_llm(&mut store, &merged);
    Ok(store)
}

pub(crate) fn persist_global_config_store(
    args: &CliArgs,
    settings: &GlobalConfigStore,
) -> Result<()> {
    let paths = resolve_project_paths(args)?;
    let persisted = PersistedSettings::from_runtime(settings);
    let mut bytes = serde_json::to_vec_pretty(&persisted).context("serialize project settings")?;
    bytes.push(b'\n');
    agent::platform::write_settings_atomically(&paths.settings_path, &bytes).with_context(|| {
        format!(
            "persist project settings at {}",
            paths.settings_path.display()
        )
    })
}

fn default_non_llm_global_config_store() -> Result<GlobalConfigStore> {
    let preset = catalog_preset(ProviderId::default()).context("builtin catalog preset")?;
    Ok(GlobalConfigStore {
        provider: preset.provider_id,
        api_key: String::new(),
        approval_policy: ApprovalPolicy::Always,
        trace_mode: TraceMode::Off,
        model: preset.model_id,
        base_url: preset.base_url,
        protocol: None,
        profile: None,
        custom_providers: BTreeMap::new(),
        max_tokens: DEFAULT_MAX_TOKENS,
        max_steps: DEFAULT_MAX_STEPS,
        thinking_level: None,
        persistence: PersistenceConfig {
            session: SessionPersistence::Items,
            diagnostic: DiagnosticPersistence::Off,
        },
        input_owner: None,
    })
}

fn cli_host_llm_layer(args: &CliArgs) -> Result<LlmConfigLayer> {
    LlmConfigLayer::new(
        args.provider.map(Into::into),
        args.model.clone(),
        args.base_url.clone(),
        args.api_key.clone(),
        None,
        None,
    )
    .context("construct CLI LLM layer")
}

fn apply_merged_llm(store: &mut GlobalConfigStore, merged: &agent::llm::ResolvedProviderConfig) {
    store.provider = merged.provider_id.clone();
    store.model = merged.model.clone();
    store.base_url = merged.base_url.clone();
    store.api_key = merged.api_key.clone();
    store.protocol = Some(merged.protocol);
}

pub(crate) fn merged_llm_from_store(
    store: &GlobalConfigStore,
) -> Result<agent::llm::ResolvedProviderConfig> {
    agent::llm::resolve_provider_config(
        store.provider.clone(),
        agent::llm::ProviderOverrides {
            base_url: Some(store.base_url.as_str()),
            model: Some(store.model.as_str()),
            api_key: Some(store.api_key.as_str()),
            protocol: store.protocol,
            user_profile: store.profile.as_ref(),
            host_profile: None,
        },
    )
}

fn validate_explicit_api_key(args: &CliArgs) -> Result<()> {
    if args
        .api_key
        .as_deref()
        .is_some_and(|value| !has_api_key(value))
    {
        bail!("explicit API key must not be empty");
    }
    Ok(())
}

fn has_api_key(value: &str) -> bool {
    !value.trim().is_empty()
}

pub(crate) fn apply_cli_non_llm_overrides(settings: &mut GlobalConfigStore, args: &CliArgs) {
    if let Some(policy) = args.approval_policy {
        settings.approval_policy = policy.into();
    }
    if let Some(trace) = args.trace {
        settings.trace_mode = trace.into();
    }
}

/// Apply explicit provider-switch side effects for the settings UI catalog cycle.
pub(crate) fn apply_provider_switch_in_store(
    provider_id: ProviderId,
    store: &mut GlobalConfigStore,
    clear_api_key: bool,
) -> Result<()> {
    apply_provider_switch(
        provider_id.clone(),
        &mut store.model,
        &mut store.base_url,
        clear_api_key,
        &mut store.api_key,
    )?;
    store.provider = provider_id;
    store.protocol = None;
    store.profile = None;
    Ok(())
}

fn load_persisted_settings(path: &Path) -> Result<PersistedSettings> {
    let bytes = fs::read(path).with_context(|| format!("read settings file {}", path.display()))?;
    let mut value: serde_json::Value = serde_json::from_slice(&bytes)
        .with_context(|| format!("parse settings file {}", path.display()))?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            anyhow::anyhow!("settings file {} has no numeric version", path.display())
        })?;
    if version != 1 && version != u64::from(SETTINGS_VERSION) {
        bail!("unsupported settings version {version} (expected {SETTINGS_VERSION} or 1)");
    }
    if version == 1 {
        let object = value.as_object_mut().ok_or_else(|| {
            anyhow::anyhow!("settings file {} must contain an object", path.display())
        })?;
        object
            .entry("provider")
            .or_insert_with(|| serde_json::Value::String(ProviderId::default().to_string()));
    }
    serde_json::from_value(value)
        .with_context(|| format!("decode settings file {}", path.display()))
        .and_then(register_persisted_custom_providers)
}

fn register_persisted_custom_providers(settings: PersistedSettings) -> Result<PersistedSettings> {
    if !settings.custom_providers.is_empty() {
        register_custom_providers(settings.custom_providers.clone())?;
    }
    Ok(settings)
}

fn ensure_custom_providers_registered(path: &Path) -> Result<()> {
    if !path.exists() {
        return register_custom_providers(BTreeMap::new());
    }
    let persisted = load_persisted_settings(path)?;
    register_custom_providers(persisted.custom_providers)
}

fn read_persisted_llm_layer(path: &Path) -> Result<LlmConfigLayer> {
    if !path.exists() {
        return Ok(LlmConfigLayer::default());
    }
    ensure_custom_providers_registered(path)?;
    load_persisted_settings(path)?.to_llm_layer()
}

fn approval_policy_arg(policy: ApprovalPolicy) -> ApprovalPolicyArg {
    match policy {
        ApprovalPolicy::Default => ApprovalPolicyArg::Default,
        ApprovalPolicy::Always => ApprovalPolicyArg::Always,
        ApprovalPolicy::AlwaysAllow => ApprovalPolicyArg::AlwaysAllow,
    }
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;

    use clap::Parser;
    use tempfile::tempdir;

    use super::*;

    struct MapEnv(BTreeMap<&'static str, String>);

    impl EnvSource for MapEnv {
        fn var(&self, name: &str) -> Option<String> {
            self.0.get(name).cloned()
        }
    }

    fn write_settings(root: &std::path::Path, model: &str, base_url: &str) {
        let settings_path = root.join(".moontide/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        let settings = serde_json::json!({
            "version": 2,
            "provider": "deepseek",
            "api_key": "settings-key",
            "approval_policy": "default",
            "trace_mode": "off",
            "model": model,
            "base_url": base_url,
            "max_tokens": 4096,
            "max_steps": 8,
            "thinking_level": null,
            "persistence": { "session": "items", "diagnostic": "off" }
        });
        fs::write(
            settings_path,
            serde_json::to_vec(&settings).expect("settings JSON"),
        )
        .expect("settings file");
    }

    // Scenario: an API key is empty or contains only whitespace.
    // Expected: the presence check returns false for both forms.
    // Invariant: an explicit empty key cannot fall back to a persisted credential.
    #[test]
    fn api_key_presence_rejects_empty_values() {
        assert!(!has_api_key(""));
        assert!(!has_api_key("  \t"));
        assert!(has_api_key("key"));

        let args = CliArgs::parse_from(["moontide", "--api-key", ""]);
        assert!(load_global_config_store(&args).is_err());
    }

    // Scenario: an explicit CLI model or base URL contains only whitespace.
    // Expected: host-layer construction rejects the value before merge.
    // Invariant: explicit blank host fields never become catalog defaults or adapter endpoints.
    #[test]
    fn rejects_blank_cli_model_and_base_url() {
        for (flag, field) in [("--model", "model"), ("--base-url", "base URL")] {
            let args = CliArgs::parse_from(["moontide", flag, "  "]);
            let error = match load_global_config_store_with_env(&args, &MapEnv(BTreeMap::new())) {
                Ok(_) => panic!("blank host field should fail"),
                Err(error) => error,
            };
            assert!(format!("{error:#}").contains(field));
        }
    }

    // Scenario: settings explicitly persist a blank model or base URL.
    // Expected: host-owned schema construction rejects the malformed field.
    // Invariant: present-but-blank settings values are distinct from an absent settings layer.
    #[test]
    fn rejects_blank_persisted_model_and_base_url() {
        for (model, base_url, field) in [
            ("  ", "https://api.deepseek.com", "model"),
            ("deepseek-chat", "\t", "base URL"),
        ] {
            let root = tempdir().expect("temporary settings project");
            write_settings(root.path(), model, base_url);
            let args = CliArgs::parse_from([
                "moontide",
                "--cwd",
                root.path().to_str().expect("UTF-8 temp path"),
            ]);
            let error = match load_global_config_store_with_env(&args, &MapEnv(BTreeMap::new())) {
                Ok(_) => panic!("blank persisted field should fail"),
                Err(error) => error,
            };
            assert!(format!("{error:#}").contains(field));
        }
    }

    // Scenario: a version-2 settings file omits provider identity.
    // Expected: the host parser rejects the file instead of assigning its credential to DeepSeek.
    // Invariant: only the version-1 migration path may synthesize a provider.
    #[test]
    fn version_two_settings_require_provider() {
        let root = tempdir().expect("temporary settings project");
        let settings_path = root.path().join(".moontide/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        fs::write(
            &settings_path,
            r#"{
                "version": 2,
                "api_key": "agnes-key",
                "approval_policy": "default",
                "trace_mode": "off",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1",
                "max_tokens": 4096,
                "max_steps": 8,
                "thinking_level": null,
                "persistence": { "session": "items", "diagnostic": "off" }
            }"#,
        )
        .expect("settings file");
        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
        ]);
        let error = match load_global_config_store_with_env(&args, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("version 2 provider is required"),
            Err(error) => error,
        };
        assert!(format!("{error:#}").contains("provider"));
    }

    // Scenario: an explicit custom model is supplied by the CLI host layer.
    // Expected: the resolved provider preserves the exact model name.
    // Invariant: catalog defaults never silently replace explicit model overrides.
    #[test]
    fn custom_cli_model_is_preserved() {
        let args = CliArgs::parse_from(["moontide", "--model", "custom-model"]);
        let settings =
            load_global_config_store_with_env(&args, &MapEnv(BTreeMap::new())).expect("settings");
        assert_eq!(settings.model, "custom-model");
    }

    // Scenario: settings select DeepSeek, env switches to Agnes, and CLI overrides model/key.
    // Expected: host wins model/key, env base URL survives, and DeepSeek credentials are ignored.
    // Invariant: settings < environment < host precedence cannot mix credentials across providers.
    #[test]
    fn cli_layers_apply_precedence_and_isolate_provider_credentials() {
        let root = tempdir().expect("temporary settings project");
        write_settings(root.path(), "deepseek-chat", "https://api.deepseek.com");
        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
            "--provider",
            "agnes",
            "--model",
            "agnes-2.0-flash",
            "--api-key",
            "host-agnes-key",
        ]);
        let env = MapEnv(BTreeMap::from([
            ("MOONTIDE_PROVIDER", "agnes".into()),
            ("MOONTIDE_MODEL", "agnes-2.5-pro".into()),
            ("MOONTIDE_BASE_URL", "https://agnes-env.example/v1".into()),
            ("DEEPSEEK_API_KEY", "wrong-deepseek-key".into()),
            ("AGNES_API_KEY", "env-agnes-key".into()),
        ]));

        let settings =
            load_global_config_store_with_env(&args, &env).expect("resolved CLI settings");
        assert_eq!(settings.provider, ProviderId::Agnes);
        assert_eq!(settings.model, "agnes-2.0-flash");
        assert_eq!(settings.base_url, "https://agnes-env.example/v1");
        assert_eq!(settings.api_key, "host-agnes-key");
    }

    // Scenario: a project settings file supplies defaults and CLI values are explicit.
    // Expected: file values load first, then explicit CLI and API key values take precedence.
    // Invariant: omitted CLI options remain distinguishable from explicit overrides.
    #[test]
    fn loads_settings_file_before_cli_overrides() {
        let root = tempdir().expect("temporary settings project");
        let settings_path = root.path().join(".moontide/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        fs::write(
            &settings_path,
            br#"{
                "version": 1,
                "provider": "agnes",
                "api_key": "file-key",
                "approval_policy": "default",
                "trace_mode": "events",
                "model": "agnes-2.0-flash",
                "base_url": "https://file.example",
                "max_tokens": 2048,
                "max_steps": 4,
                "thinking_level": "low",
                "persistence": {
                    "session": "items",
                    "diagnostic": "off"
                }
            }"#,
        )
        .expect("settings file");

        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
            "--provider",
            "agnes",
            "--model",
            "agnes-2.5-pro",
            "--api-key",
            "cli-key",
        ]);
        let settings = load_global_config_store(&args).expect("global config store");

        assert_eq!(settings.api_key, "cli-key");
        assert_eq!(settings.model, "agnes-2.5-pro");
        assert_eq!(settings.base_url, "https://file.example");
        assert_eq!(settings.max_steps, 4);
        assert_eq!(settings.max_tokens, 2048);
        assert_eq!(settings.thinking_level, Some(ThinkingLevel::Low));
    }

    // Scenario: a settings file declares an unsupported schema version.
    // Expected: loading fails with an explicit version error and preserves the file.
    // Invariant: invalid configuration is never silently replaced by defaults.
    #[test]
    fn rejects_unsupported_settings_version() {
        let root = tempdir().expect("temporary settings project");
        let settings_path = root.path().join(".moontide/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        let original = br#"{"version":99}"#;
        fs::write(&settings_path, original).expect("unsupported settings file");
        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
        ]);

        let error = match load_global_config_store(&args) {
            Ok(_) => panic!("unsupported version should fail"),
            Err(error) => error,
        };

        assert!(error.to_string().contains("unsupported settings version"));
        assert_eq!(
            fs::read(&settings_path).expect("preserved settings"),
            original
        );
    }

    // Scenario: runtime settings are persisted after a Settings change.
    // Expected: versioned JSON contains the complete current runtime configuration.
    // Invariant: API key persistence is explicit and remains outside Session Item Log storage.
    #[test]
    fn persists_versioned_runtime_settings() {
        let root = tempdir().expect("temporary settings project");
        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
        ]);
        let settings = GlobalConfigStore {
            provider: ProviderId::Agnes,
            api_key: "persisted-key".into(),
            approval_policy: ApprovalPolicy::AlwaysAllow,
            trace_mode: TraceMode::EventsAndThinking,
            model: "agnes-2.5-pro".into(),
            base_url: "https://persisted.example".into(),
            protocol: None,
            profile: None,
            custom_providers: BTreeMap::new(),
            max_tokens: 8192,
            max_steps: 12,
            thinking_level: Some(ThinkingLevel::High),
            persistence: PersistenceConfig {
                session: SessionPersistence::Items,
                diagnostic: DiagnosticPersistence::Off,
            },
            input_owner: None,
        };

        persist_global_config_store(&args, &settings).expect("settings should persist");
        let path = root.path().join(".moontide/settings.json");
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(path).expect("read persisted settings"))
                .expect("persisted settings JSON");

        assert_eq!(value["version"], 2);
        assert_eq!(value["provider"], "agnes");
        assert_eq!(value["api_key"], "persisted-key");
        assert_eq!(value["model"], "agnes-2.5-pro");
        assert_eq!(value["thinking_level"], "high");
        assert_eq!(value["persistence"]["session"], "items");
        assert_eq!(value["persistence"]["diagnostic"], "off");

        let reloaded = load_global_config_store(&args).expect("global config store should reload");
        assert_eq!(reloaded.model, "agnes-2.5-pro");
        assert_eq!(reloaded.max_steps, 12);
    }

    // Scenario: a version-1 settings file lacks the provider field.
    // Expected: load succeeds with provider defaulting to deepseek.
    // Invariant: v1 settings migrate forward without rewriting the file until persist.
    #[test]
    fn loads_version_one_settings_with_default_provider() {
        let root = tempdir().expect("temporary settings project");
        let settings_path = root.path().join(".moontide/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        fs::write(
            &settings_path,
            br#"{
                "version": 1,
                "api_key": "file-key",
                "approval_policy": "default",
                "trace_mode": "off",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com",
                "max_tokens": 4096,
                "max_steps": 8,
                "persistence": {
                    "session": "items",
                    "diagnostic": "off"
                }
            }"#,
        )
        .expect("settings file");

        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
            "--api-key",
            "file-key",
        ]);
        let settings = load_global_config_store(&args).expect("global config store");
        assert_eq!(settings.provider, ProviderId::Deepseek);
    }
}
