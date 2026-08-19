use std::{env, fs, path::Path};

use agent::ThinkingLevel;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    args::{ApprovalPolicyArg, CliArgs, TraceModeArg},
    config::{resolve_project_paths, DEFAULT_MAX_STEPS, DEFAULT_MAX_TOKENS},
    input::InputOwner,
    render::write_diagnostic_stderr,
};

const SETTINGS_VERSION: u32 = 1;
const API_KEY_ENV: &str = "DEEPSEEK_API_KEY";

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
    pub(crate) api_key: String,
    pub(crate) approval_policy: ApprovalPolicy,
    pub(crate) trace_mode: TraceMode,
    pub(crate) model: String,
    pub(crate) base_url: String,
    pub(crate) max_tokens: u32,
    pub(crate) max_steps: u32,
    pub(crate) thinking_level: Option<ThinkingLevel>,
    pub(crate) input_owner: Option<InputOwner>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSettings {
    version: u32,
    api_key: String,
    approval_policy: ApprovalPolicy,
    trace_mode: TraceMode,
    model: String,
    base_url: String,
    max_tokens: u32,
    max_steps: u32,
    thinking_level: Option<ThinkingLevel>,
}

impl PersistedSettings {
    fn from_runtime(settings: &GlobalConfigStore) -> Self {
        Self {
            version: SETTINGS_VERSION,
            api_key: settings.api_key.clone(),
            approval_policy: settings.approval_policy,
            trace_mode: settings.trace_mode,
            model: settings.model.clone(),
            base_url: settings.base_url.clone(),
            max_tokens: settings.max_tokens,
            max_steps: settings.max_steps,
            thinking_level: settings.thinking_level,
        }
    }

    fn apply_to(self, settings: &mut GlobalConfigStore) -> Result<()> {
        if self.version != SETTINGS_VERSION {
            bail!(
                "unsupported settings version {} (expected {})",
                self.version,
                SETTINGS_VERSION
            );
        }
        settings.api_key = self.api_key;
        settings.approval_policy = self.approval_policy;
        settings.trace_mode = self.trace_mode;
        settings.model = self.model;
        settings.base_url = self.base_url;
        settings.max_tokens = self.max_tokens;
        settings.max_steps = self.max_steps;
        settings.thinking_level = self.thinking_level;
        Ok(())
    }
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

pub(crate) fn resolve_one_shot(args: &CliArgs) -> Result<GlobalConfigStore> {
    let settings = load_global_config_store(args)?;
    if !has_api_key(&settings.api_key) {
        bail!(
            "API key is required for one-shot mode; provide --api-key, DEEPSEEK_API_KEY, or settings.json"
        );
    }
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

    if settings.api_key.trim().is_empty() {
        write_diagnostic_stderr("DeepSeek API key not found; enter it (hidden input):")
            .context("write API key prompt")?;
        settings.api_key = input_owner.read_secret()?;
        if !has_api_key(&settings.api_key) {
            bail!("DeepSeek API key must not be empty");
        }
    } else if args.api_key.is_some() {
        write_diagnostic_stderr("DeepSeek API key: detected in CLI/environment")
            .context("write API key status")?;
    } else {
        write_diagnostic_stderr("DeepSeek API key: loaded from project settings")
            .context("write API key status")?;
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

pub(crate) fn load_global_config_store(args: &CliArgs) -> Result<GlobalConfigStore> {
    validate_explicit_api_key(args)?;
    let paths = resolve_project_paths(args)?;
    let mut settings = default_global_config_store();
    if paths.settings_path.exists() {
        let persisted = load_persisted_settings(&paths.settings_path)?;
        persisted.apply_to(&mut settings)?;
    }
    apply_cli_overrides(&mut settings, args);
    Ok(settings)
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

pub(crate) fn default_global_config_store() -> GlobalConfigStore {
    GlobalConfigStore {
        api_key: String::new(),
        approval_policy: ApprovalPolicy::Always,
        trace_mode: TraceMode::Off,
        model: "deepseek-chat".into(),
        base_url: "https://api.deepseek.com".into(),
        max_tokens: DEFAULT_MAX_TOKENS,
        max_steps: DEFAULT_MAX_STEPS,
        thinking_level: None,
        input_owner: None,
    }
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

pub(crate) fn apply_cli_overrides(settings: &mut GlobalConfigStore, args: &CliArgs) {
    if let Some(api_key) = args.api_key.as_deref() {
        settings.api_key = api_key.to_owned();
    }
    if let Some(model) = args.model.as_deref() {
        settings.model = model.to_owned();
    }
    if let Some(base_url) = args.base_url.as_deref() {
        settings.base_url = base_url.to_owned();
    }
    if let Some(policy) = args.approval_policy {
        settings.approval_policy = policy.into();
    }
    if let Some(trace) = args.trace {
        settings.trace_mode = trace.into();
    }
}

fn load_persisted_settings(path: &Path) -> Result<PersistedSettings> {
    let bytes = fs::read(path).with_context(|| format!("read settings file {}", path.display()))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .with_context(|| format!("parse settings file {}", path.display()))?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            anyhow::anyhow!("settings file {} has no numeric version", path.display())
        })?;
    if version != u64::from(SETTINGS_VERSION) {
        bail!("unsupported settings version {version} (expected {SETTINGS_VERSION})");
    }
    serde_json::from_value(value)
        .with_context(|| format!("decode settings file {}", path.display()))
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
    use std::fs;

    use clap::Parser;
    use tempfile::tempdir;

    use super::*;

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
                "api_key": "file-key",
                "approval_policy": "default",
                "trace_mode": "events",
                "model": "file-model",
                "base_url": "https://file.example",
                "max_tokens": 2048,
                "max_steps": 4,
                "thinking_level": "low"
            }"#,
        )
        .expect("settings file");

        let args = CliArgs::parse_from([
            "moontide",
            "--cwd",
            root.path().to_str().expect("UTF-8 temp path"),
            "--model",
            "cli-model",
            "--api-key",
            "cli-key",
        ]);
        let settings = load_global_config_store(&args).expect("global config store");

        assert_eq!(settings.api_key, "cli-key");
        assert_eq!(settings.model, "cli-model");
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
            api_key: "persisted-key".into(),
            approval_policy: ApprovalPolicy::AlwaysAllow,
            trace_mode: TraceMode::EventsAndThinking,
            model: "persisted-model".into(),
            base_url: "https://persisted.example".into(),
            max_tokens: 8192,
            max_steps: 12,
            thinking_level: Some(ThinkingLevel::High),
            input_owner: None,
        };

        persist_global_config_store(&args, &settings).expect("settings should persist");
        let path = root.path().join(".moontide/settings.json");
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(path).expect("read persisted settings"))
                .expect("persisted settings JSON");

        assert_eq!(value["version"], 1);
        assert_eq!(value["api_key"], "persisted-key");
        assert_eq!(value["model"], "persisted-model");
        assert_eq!(value["thinking_level"], "high");

        let reloaded = load_global_config_store(&args).expect("global config store should reload");
        assert_eq!(reloaded.model, "persisted-model");
        assert_eq!(reloaded.max_steps, 12);
    }
}
