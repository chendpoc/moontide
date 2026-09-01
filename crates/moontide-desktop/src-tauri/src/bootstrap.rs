use std::{collections::BTreeMap, env, fs, path::Path};

use agent::{
    llm::{
        merge_startup_llm_config, read_llm_env, require_api_key, EnvSource, LlmConfigLayer,
        ProcessEnv, ProviderId,
    },
    platform::ProjectPaths,
    AgentConfig, PersistenceConfig, SessionPersistence, ToolPermission, ToolPermissionMap,
};
use anyhow::{Context, Result};
use serde::Deserialize;

use crate::runtime::{DesktopRuntime, DesktopRuntimeCoordinator};

const DEFAULT_MAX_TOKENS: u32 = 4_096;
const DEFAULT_MAX_STEPS: u32 = 8;
const DEFAULT_EVENT_CAPACITY: usize = 256;
const SETTINGS_VERSION: u32 = 2;

#[derive(Deserialize)]
struct DesktopPersistedLlmSettings {
    #[allow(dead_code)]
    version: u32,
    provider: ProviderId,
    model: String,
    base_url: String,
    api_key: String,
}

pub(crate) fn start_runtime() -> Result<DesktopRuntimeCoordinator> {
    dotenvy::dotenv().ok();
    DesktopRuntimeCoordinator::start(
        || {
            let agent_config = build_agent_config()?;
            DesktopRuntime::start(agent_config, DEFAULT_EVENT_CAPACITY)
        },
        DEFAULT_EVENT_CAPACITY,
    )
}

fn build_agent_config() -> Result<AgentConfig> {
    let cwd = env::current_dir().context("resolve current working directory")?;
    let paths = ProjectPaths::resolve(cwd, None, None)?;
    build_agent_config_for_paths(&paths, &ProcessEnv)
}

fn read_persisted_llm_layer(path: &Path) -> Result<LlmConfigLayer> {
    if !path.exists() {
        return Ok(LlmConfigLayer::default());
    }
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
        anyhow::bail!("unsupported settings version {version} (expected {SETTINGS_VERSION} or 1)");
    }
    if version == 1 {
        let object = value.as_object_mut().ok_or_else(|| {
            anyhow::anyhow!("settings file {} must contain an object", path.display())
        })?;
        object
            .entry("provider")
            .or_insert_with(|| serde_json::Value::String(ProviderId::default().to_string()));
    }
    let persisted: DesktopPersistedLlmSettings = serde_json::from_value(value)
        .with_context(|| format!("decode settings file {}", path.display()))?;
    LlmConfigLayer::new(
        Some(persisted.provider),
        Some(persisted.model),
        Some(persisted.base_url),
        optional_api_key(Some(persisted.api_key)),
    )
    .context("construct Desktop settings LLM layer")
}

fn optional_api_key(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_owned())
    })
}

pub(crate) fn build_agent_config_for_paths(
    paths: &ProjectPaths,
    env: &impl EnvSource,
) -> Result<AgentConfig> {
    let settings_layer = read_persisted_llm_layer(&paths.settings_path)?;
    let env_layer = read_llm_env(env)?;
    let merged = merge_startup_llm_config(&settings_layer, &env_layer, &LlmConfigLayer::default())?;
    require_api_key(&merged)?;

    let (tool_names, permissions) = coding_preset();

    Ok(AgentConfig {
        cwd: paths.cwd.clone(),
        sessions_dir: paths.sessions_dir.clone(),
        runs_dir: paths.runs_dir.clone(),
        provider: merged,
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

#[cfg(test)]
mod tests {
    use super::*;
    use agent::llm::ProviderId;
    use std::fs;
    use tempfile::tempdir;

    struct MapEnv(BTreeMap<&'static str, String>);

    impl EnvSource for MapEnv {
        fn var(&self, name: &str) -> Option<String> {
            self.0.get(name).cloned()
        }
    }

    fn project_with_settings(json: &str) -> (tempfile::TempDir, ProjectPaths) {
        let root = tempdir().expect("temporary desktop project");
        let settings_path = root.path().join(".moontide/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        fs::write(&settings_path, json.as_bytes()).expect("settings file");
        let paths =
            ProjectPaths::resolve(root.path().to_owned(), None, None).expect("project paths");
        (root, paths)
    }

    // Scenario: Desktop starts with no settings file and no env credentials.
    // Expected: bootstrap fails at require_api_key with the catalog env name.
    // Invariant: Desktop never reads stdin for API keys.
    #[test]
    fn build_agent_config_requires_credentials_without_settings() {
        let root = tempdir().expect("temporary desktop project");
        let paths =
            ProjectPaths::resolve(root.path().to_owned(), None, None).expect("project paths");
        let error = match build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("missing credentials"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("DEEPSEEK_API_KEY"));
    }

    // Scenario: settings.json supplies provider, model, and API key.
    // Expected: merged AgentConfig reflects persisted LLM fields.
    // Invariant: empty host layer does not override settings.
    #[test]
    fn build_agent_config_loads_persisted_settings() {
        let (_root, paths) = project_with_settings(
            r#"{
                "version": 2,
                "provider": "agnes",
                "model": "agnes-2.5-pro",
                "base_url": "https://api.agnes-ai.cn/v1",
                "api_key": "settings-key",
                "approval_policy": "default",
                "trace_mode": "off",
                "max_tokens": 4096,
                "max_steps": 8,
                "persistence": { "session": "items", "diagnostic": "off" }
            }"#,
        );
        let config =
            build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())).expect("config");
        assert_eq!(config.provider.provider_id, ProviderId::Agnes);
        assert_eq!(config.provider.model, "agnes-2.5-pro");
        assert_eq!(config.provider.api_key, "settings-key");
    }

    // Scenario: environment provides the winning API key for the final provider.
    // Expected: env key overrides settings without changing provider selection.
    // Invariant: AGNES_API_KEY alone does not switch provider away from settings.
    #[test]
    fn build_agent_config_env_key_overrides_settings_key() {
        let (_root, paths) = project_with_settings(
            r#"{
                "version": 2,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com",
                "api_key": "settings-key",
                "approval_policy": "default",
                "trace_mode": "off",
                "max_tokens": 4096,
                "max_steps": 8,
                "persistence": { "session": "items", "diagnostic": "off" }
            }"#,
        );
        let env = MapEnv(BTreeMap::from([("DEEPSEEK_API_KEY", "env-key".into())]));
        let config = build_agent_config_for_paths(&paths, &env).expect("config");
        assert_eq!(config.provider.provider_id, ProviderId::Deepseek);
        assert_eq!(config.provider.api_key, "env-key");
    }

    // Scenario: settings select DeepSeek while environment selects Agnes and supplies both keys.
    // Expected: the complete Agnes environment bundle wins and uses only the Agnes credential.
    // Invariant: a provider change cannot retain a lower-layer provider endpoint or credential.
    #[test]
    fn environment_provider_switch_isolates_endpoint_and_credential() {
        let (_root, paths) = project_with_settings(
            r#"{
                "version": 2,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com",
                "api_key": "settings-deepseek-key"
            }"#,
        );
        let env = MapEnv(BTreeMap::from([
            ("MOONTIDE_PROVIDER", "agnes".into()),
            ("MOONTIDE_MODEL", "agnes-2.5-pro".into()),
            ("MOONTIDE_BASE_URL", "https://agnes-env.example/v1".into()),
            ("DEEPSEEK_API_KEY", "wrong-deepseek-key".into()),
            ("AGNES_API_KEY", "agnes-env-key".into()),
        ]));

        let config = build_agent_config_for_paths(&paths, &env).expect("Agnes config");
        assert_eq!(config.provider.provider_id, ProviderId::Agnes);
        assert_eq!(config.provider.model, "agnes-2.5-pro");
        assert_eq!(config.provider.base_url, "https://agnes-env.example/v1");
        assert_eq!(config.provider.api_key, "agnes-env-key");
    }

    // Scenario: only AGNES_API_KEY is present while settings omit provider and key.
    // Expected: provider stays catalog default DeepSeek and bootstrap still requires DeepSeek key.
    // Invariant: provider-specific env keys do not auto-select provider.
    #[test]
    fn agnes_env_key_does_not_auto_select_provider() {
        let root = tempdir().expect("temporary desktop project");
        let paths =
            ProjectPaths::resolve(root.path().to_owned(), None, None).expect("project paths");
        let env = MapEnv(BTreeMap::from([("AGNES_API_KEY", "agnes-only".into())]));
        let error = match build_agent_config_for_paths(&paths, &env) {
            Ok(_) => panic!("deepseek key required"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("DEEPSEEK_API_KEY"));
    }

    // Scenario: settings file JSON is not parseable.
    // Expected: bootstrap returns a parse error and does not fall back to defaults silently.
    // Invariant: corrupt settings are surfaced to the host startup path.
    #[test]
    fn build_agent_config_rejects_corrupt_settings_json() {
        let (_root, paths) = project_with_settings("{not-json");
        let error = match build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("corrupt settings"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("parse settings file"));
    }

    // Scenario: settings file declares an unsupported schema version.
    // Expected: bootstrap fails with an explicit version error.
    // Invariant: unknown versions never silently downgrade to catalog defaults.
    #[test]
    fn build_agent_config_rejects_unsupported_settings_version() {
        let (_root, paths) = project_with_settings(r#"{"version":99}"#);
        let error = match build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("unsupported version"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("unsupported settings version"));
    }

    // Scenario: a persisted model or base URL is explicitly blank.
    // Expected: Desktop rejects the host-owned settings layer before merge.
    // Invariant: present-but-blank values never become defaults or adapter endpoints.
    #[test]
    fn build_agent_config_rejects_blank_model_and_base_url() {
        for (model, base_url, field) in [
            ("  ", "https://api.deepseek.com", "model"),
            ("deepseek-chat", "\t", "base URL"),
        ] {
            let json = serde_json::json!({
                "version": 2,
                "provider": "deepseek",
                "model": model,
                "base_url": base_url,
                "api_key": "settings-key"
            });
            let (_root, paths) = project_with_settings(&json.to_string());
            let error = match build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())) {
                Ok(_) => panic!("blank settings field should fail"),
                Err(error) => error,
            };
            assert!(format!("{error:#}").contains(field));
        }
    }

    // Scenario: a version-2 Desktop settings file omits provider identity.
    // Expected: Desktop rejects the file instead of assigning its credential to DeepSeek.
    // Invariant: only version-1 host migration may synthesize provider identity.
    #[test]
    fn desktop_version_two_settings_require_provider() {
        let (_root, paths) = project_with_settings(
            r#"{
                "version": 2,
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1",
                "api_key": "agnes-key"
            }"#,
        );
        let error = match build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("version 2 provider is required"),
            Err(error) => error,
        };
        assert!(format!("{error:#}").contains("provider"));
    }

    // Scenario: a version-2 Desktop settings file omits an endpoint field.
    // Expected: Desktop rejects the file just as the CLI schema does.
    // Invariant: host-owned schemas agree on required v2 LLM fields.
    #[test]
    fn desktop_version_two_settings_require_model_and_base_url() {
        for missing_field in ["model", "base_url"] {
            let mut value = serde_json::json!({
                "version": 2,
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1",
                "api_key": "agnes-key"
            });
            value
                .as_object_mut()
                .expect("settings object")
                .remove(missing_field);
            let (_root, paths) = project_with_settings(&value.to_string());
            let error = match build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())) {
                Ok(_) => panic!("version 2 endpoint field is required"),
                Err(error) => error,
            };
            assert!(format!("{error:#}").contains(missing_field));
        }
    }

    // Scenario: Desktop reads a version-1 settings file that predates provider identity.
    // Expected: the host migrates the layer to DeepSeek without rewriting the file.
    // Invariant: version migration belongs to the Desktop settings parser, not agent::llm.
    #[test]
    fn desktop_settings_version_one_defaults_provider_to_deepseek() {
        let (_root, paths) = project_with_settings(
            r#"{
                "version": 1,
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com",
                "api_key": "settings-key"
            }"#,
        );
        let config =
            build_agent_config_for_paths(&paths, &MapEnv(BTreeMap::new())).expect("config");
        assert_eq!(config.provider.provider_id, ProviderId::Deepseek);
    }

    // Scenario: Desktop bootstrap sources must not reach into agent-core catalog directly.
    // Expected: production bootstrap imports agent::llm merge helpers only.
    // Invariant: host-facing catalog boundary matches CLI.
    #[test]
    fn desktop_bootstrap_does_not_import_agent_core_llm_catalog_directly() {
        let production = include_str!("bootstrap.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("bootstrap production source");
        assert!(
            !production.contains("agent_core::llm::catalog"),
            "Desktop bootstrap must not import agent-core LLM catalog directly"
        );
    }
}
