use std::collections::BTreeMap;
use std::fs;
use std::path::{
    Path,
    PathBuf,
};

use agent::llm::{
    merge_startup_llm_config,
    read_llm_env,
    register_custom_providers,
    require_api_key,
    CustomProviderDefinition,
    EnvSource,
    LlmConfigLayer,
    ProcessEnv,
    ProviderId,
    UserProtocolProfileOverride,
};
use agent::platform::ProjectPaths;
use agent::{
    resolve_coding_preset,
    AdapterFamily,
    AgentConfig,
    CodingPresetPolicy,
    PersistenceConfig,
    SessionPersistence,
};
use anyhow::{
    Context,
    Result,
};
use serde::Deserialize;

use crate::runtime::{
    DesktopRuntime,
    DesktopRuntimeCoordinator,
};

const DEFAULT_MAX_TOKENS: u32 = 4_096;
const DEFAULT_MAX_STEPS: u32 = 8;
const DEFAULT_EVENT_CAPACITY: usize = 256;
const SETTINGS_VERSION: u32 = 3;
const SETTINGS_FILE_NAME: &str = "settings.json";
const CONTENT_DIRECTORY_NAME: &str = "content";
const SESSIONS_DIRECTORY_NAME: &str = "sessions";
const RUNS_DIRECTORY_NAME: &str = "runs";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DesktopPersistedSettings {
    #[serde(rename = "version")]
    _version: u32,
    project_root: PathBuf,
    provider: ProviderId,
    model: String,
    base_url: String,
    #[serde(default)]
    protocol: Option<AdapterFamily>,
    #[serde(default)]
    profile: Option<UserProtocolProfileOverride>,
    #[serde(default)]
    custom_providers: BTreeMap<String, CustomProviderDefinition>,
}

struct DesktopEnv<'a, E> {
    inherited: &'a E,
    project: BTreeMap<String, String>,
}

impl<E: EnvSource> EnvSource for DesktopEnv<'_, E> {
    fn var(&self, name: &str) -> Option<String> {
        self.inherited
            .var(name)
            .or_else(|| self.project.get(name).cloned())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DesktopStoragePaths {
    pub(crate) settings_path: PathBuf,
    pub(crate) sessions_dir: PathBuf,
    pub(crate) runs_dir: PathBuf,
}

impl DesktopStoragePaths {
    pub(crate) fn from_app_directories(
        app_config_dir: PathBuf,
        app_data_dir: PathBuf,
    ) -> Result<Self> {
        if !app_config_dir.is_absolute() {
            anyhow::bail!(
                "Desktop application config directory must be absolute: {}",
                app_config_dir.display()
            );
        }
        if !app_data_dir.is_absolute() {
            anyhow::bail!(
                "Desktop application data directory must be absolute: {}",
                app_data_dir.display()
            );
        }
        let content_dir = app_data_dir.join(CONTENT_DIRECTORY_NAME);
        Ok(Self {
            settings_path: app_config_dir.join(SETTINGS_FILE_NAME),
            sessions_dir: content_dir.join(SESSIONS_DIRECTORY_NAME),
            runs_dir: content_dir.join(RUNS_DIRECTORY_NAME),
        })
    }
}

pub(crate) fn start_runtime(storage: DesktopStoragePaths) -> Result<DesktopRuntimeCoordinator> {
    DesktopRuntimeCoordinator::start(
        move || {
            let agent_config = build_agent_config_for_storage(&storage, &ProcessEnv)?;
            DesktopRuntime::start(agent_config, DEFAULT_EVENT_CAPACITY)
        },
        DEFAULT_EVENT_CAPACITY,
    )
}

fn read_persisted_settings(path: &Path) -> Result<DesktopPersistedSettings> {
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
        anyhow::bail!(
            "unsupported Desktop settings version {version} (expected {SETTINGS_VERSION})"
        );
    }
    let persisted: DesktopPersistedSettings = serde_json::from_value(value)
        .with_context(|| format!("decode settings file {}", path.display()))?;
    if !persisted.custom_providers.is_empty() {
        register_custom_providers(persisted.custom_providers.clone())?;
    }
    if !persisted.project_root.is_absolute() {
        anyhow::bail!(
            "Desktop settings project_root must be absolute: {}",
            persisted.project_root.display()
        );
    }
    Ok(persisted)
}

fn build_agent_config_for_storage(
    storage: &DesktopStoragePaths,
    env: &impl EnvSource,
) -> Result<AgentConfig> {
    let persisted = read_persisted_settings(&storage.settings_path)?;
    register_custom_providers(persisted.custom_providers)?;
    let project_env = read_project_dotenv(&persisted.project_root)?;
    let desktop_env = DesktopEnv {
        inherited: env,
        project: project_env,
    };
    let settings_layer = LlmConfigLayer::new(
        Some(persisted.provider),
        Some(persisted.model),
        Some(persisted.base_url),
        None,
        persisted.protocol,
        persisted.profile,
    )
    .context("construct Desktop settings LLM layer")?;
    let env_layer = read_llm_env(&desktop_env)?;
    let merged = merge_startup_llm_config(&settings_layer, &env_layer, &LlmConfigLayer::default())?;
    require_api_key(&merged)?;
    let paths = ProjectPaths::resolve(
        persisted.project_root,
        Some(storage.sessions_dir.clone()),
        Some(storage.runs_dir.clone()),
    )?;

    let (tool_names, permissions) = resolve_coding_preset(CodingPresetPolicy::DesktopDefault);

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

fn read_project_dotenv(project_root: &Path) -> Result<BTreeMap<String, String>> {
    let path = project_root.join(".env");
    match path.try_exists() {
        Ok(false) => return Ok(BTreeMap::new()),
        Ok(true) => {}
        Err(error) => {
            return Err(error).with_context(|| format!("inspect dotenv file {}", path.display()));
        }
    }

    dotenvy::from_path_iter(&path)
        .with_context(|| format!("open dotenv file {}", path.display()))?
        .map(|entry| entry.with_context(|| format!("parse dotenv file {}", path.display())))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use agent::llm::ProviderId;
    use tempfile::tempdir;

    use super::*;

    struct MapEnv(BTreeMap<&'static str, String>);

    impl EnvSource for MapEnv {
        fn var(&self, name: &str) -> Option<String> {
            self.0.get(name).cloned()
        }
    }

    fn storage_with_settings(json: &str) -> (tempfile::TempDir, DesktopStoragePaths) {
        let root = tempdir().expect("temporary Desktop storage");
        let project_root = root.path().join("project");
        fs::create_dir(&project_root).expect("project root");
        let storage = DesktopStoragePaths::from_app_directories(
            root.path().join("app-config"),
            root.path().join("app-data"),
        )
        .expect("Desktop storage paths");
        fs::create_dir_all(storage.settings_path.parent().expect("settings parent"))
            .expect("settings parent directory");
        let bytes = match serde_json::from_str::<serde_json::Value>(json) {
            Ok(mut value) => {
                if let Some(object) = value.as_object_mut() {
                    object.entry("project_root").or_insert_with(|| {
                        serde_json::Value::String(project_root.to_string_lossy().into_owned())
                    });
                }
                serde_json::to_vec(&value).expect("settings JSON")
            }
            Err(_) => json.as_bytes().to_vec(),
        };
        fs::write(&storage.settings_path, bytes).expect("settings file");
        (root, storage)
    }

    // Scenario: Tauri supplies absolute application configuration and data directories.
    // Expected: Desktop settings and content paths are derived under their matching scopes.
    // Invariant: storage layout never consults or embeds the process working directory.
    #[test]
    fn desktop_storage_layout_is_stable_under_app_directories() {
        let root = tempdir().expect("temporary application directories");
        let config_dir = root.path().join("config");
        let data_dir = root.path().join("data");
        let storage =
            DesktopStoragePaths::from_app_directories(config_dir.clone(), data_dir.clone())
                .expect("Desktop storage paths");

        assert_eq!(storage.settings_path, config_dir.join("settings.json"));
        assert_eq!(storage.sessions_dir, data_dir.join("content/sessions"));
        assert_eq!(storage.runs_dir, data_dir.join("content/runs"));
    }

    // Scenario: Desktop starts without its fixed application settings file.
    // Expected: bootstrap reports the missing fixed path instead of falling back to process cwd.
    // Invariant: an arbitrary launch directory can never become an implicit Desktop project.
    #[test]
    fn build_agent_config_requires_fixed_settings_file() {
        let root = tempdir().expect("temporary application config directory");
        let storage = DesktopStoragePaths::from_app_directories(
            root.path().join("config"),
            root.path().join("data"),
        )
        .expect("Desktop storage paths");
        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("missing settings"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("read settings file"));
        assert!(error.to_string().contains("settings.json"));
    }

    // Scenario: version-3 settings select Agnes while its credential comes from environment.
    // Expected: AgentConfig uses the explicit project root and application content directories.
    // Invariant: Desktop JSON owns no provider credential and process cwd owns no storage path.
    #[test]
    fn build_agent_config_loads_persisted_settings() {
        let (root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "agnes",
                "model": "agnes-2.5-pro",
                "base_url": "https://api.agnes-ai.cn/v1"
            }"#,
        );
        let env = MapEnv(BTreeMap::from([("AGNES_API_KEY", "env-key".into())]));
        let config = build_agent_config_for_storage(&storage, &env).expect("config");
        assert_eq!(config.cwd, root.path().join("project"));
        assert_eq!(config.sessions_dir, storage.sessions_dir);
        assert_eq!(config.runs_dir, storage.runs_dir);
        assert_eq!(config.provider.provider_id, ProviderId::Agnes);
        assert_eq!(config.provider.model, "agnes-2.5-pro");
        assert_eq!(config.provider.api_key, "env-key");
    }

    // Scenario: environment provides the API key for the provider selected by settings.
    // Expected: the matching environment key completes the resolved configuration.
    // Invariant: Desktop JSON never persists or supplies a provider credential.
    #[test]
    fn build_agent_config_uses_provider_environment_key() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com"
            }"#,
        );
        let env = MapEnv(BTreeMap::from([("DEEPSEEK_API_KEY", "env-key".into())]));
        let config = build_agent_config_for_storage(&storage, &env).expect("config");
        assert_eq!(config.provider.provider_id, ProviderId::Deepseek);
        assert_eq!(config.provider.api_key, "env-key");
    }

    // Scenario: the selected project stores its development credential in a local dotenv file.
    // Expected: Desktop reads that explicit file without consulting the shell launch directory.
    // Invariant: project_root, not process cwd, owns optional development dotenv discovery.
    #[test]
    fn build_agent_config_reads_dotenv_from_project_root() {
        let (root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1"
            }"#,
        );
        fs::write(
            root.path().join("project/.env"),
            "AGNES_API_KEY=project-key\n",
        )
        .expect("project dotenv");

        let config = build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new()))
            .expect("config from project dotenv");

        assert_eq!(config.provider.api_key, "project-key");
    }

    // Scenario: inherited process environment and project dotenv define the same provider fields.
    // Expected: the inherited environment wins without mutating process-global state.
    // Invariant: project dotenv is a development fallback, not a higher-precedence host override.
    #[test]
    fn inherited_environment_overrides_project_dotenv() {
        let (root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1"
            }"#,
        );
        fs::write(
            root.path().join("project/.env"),
            "MOONTIDE_MODEL=dotenv-model\nAGNES_API_KEY=dotenv-key\n",
        )
        .expect("project dotenv");
        let env = MapEnv(BTreeMap::from([
            ("MOONTIDE_MODEL", "inherited-model".into()),
            ("AGNES_API_KEY", "inherited-key".into()),
        ]));

        let config = build_agent_config_for_storage(&storage, &env).expect("config");

        assert_eq!(config.provider.model, "inherited-model");
        assert_eq!(config.provider.api_key, "inherited-key");
    }

    // Scenario: explicit project dotenv exists but is malformed.
    // Expected: Desktop reports the parse failure instead of hiding it as a missing credential.
    // Invariant: only a missing dotenv file is an accepted no-op.
    #[test]
    fn malformed_project_dotenv_is_rejected() {
        let (root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1"
            }"#,
        );
        fs::write(
            root.path().join("project/.env"),
            "AGNES_API_KEY='unterminated\n",
        )
        .expect("malformed project dotenv");

        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("malformed dotenv should fail"),
            Err(error) => error,
        };

        assert!(format!("{error:#}").contains("parse dotenv file"));
    }

    // Scenario: Desktop settings contain a credential field from the legacy schema.
    // Expected: version-3 decoding rejects the field instead of silently ignoring a secret.
    // Invariant: persisted Desktop settings cannot represent provider credentials.
    #[test]
    fn desktop_settings_reject_api_key_field() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1",
                "api_key": "must-not-be-persisted"
            }"#,
        );

        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("credential field should fail"),
            Err(error) => error,
        };

        assert!(format!("{error:#}").contains("unknown field `api_key`"));
    }

    // Scenario: settings select DeepSeek while environment selects Agnes and supplies both keys.
    // Expected: the complete Agnes environment bundle wins and uses only the Agnes credential.
    // Invariant: a provider change cannot retain a lower-layer provider endpoint or credential.
    #[test]
    fn environment_provider_switch_isolates_endpoint_and_credential() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com"
            }"#,
        );
        let env = MapEnv(BTreeMap::from([
            ("MOONTIDE_PROVIDER", "agnes".into()),
            ("MOONTIDE_MODEL", "agnes-2.5-pro".into()),
            ("MOONTIDE_BASE_URL", "https://agnes-env.example/v1".into()),
            ("DEEPSEEK_API_KEY", "wrong-deepseek-key".into()),
            ("AGNES_API_KEY", "agnes-env-key".into()),
        ]));

        let config = build_agent_config_for_storage(&storage, &env).expect("Agnes config");
        assert_eq!(config.provider.provider_id, ProviderId::Agnes);
        assert_eq!(config.provider.model, "agnes-2.5-pro");
        assert_eq!(config.provider.base_url, "https://agnes-env.example/v1");
        assert_eq!(config.provider.api_key, "agnes-env-key");
    }

    // Scenario: settings select DeepSeek while only an Agnes credential exists in environment.
    // Expected: provider stays DeepSeek and bootstrap still requires its matching key.
    // Invariant: provider-specific env keys do not auto-select provider.
    #[test]
    fn agnes_env_key_does_not_auto_select_provider() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com"
            }"#,
        );
        let env = MapEnv(BTreeMap::from([("AGNES_API_KEY", "agnes-only".into())]));
        let error = match build_agent_config_for_storage(&storage, &env) {
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
        let (_root, storage) = storage_with_settings("{not-json");
        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
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
        let (_root, storage) = storage_with_settings(r#"{"version":99}"#);
        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("unsupported version"),
            Err(error) => error,
        };
        assert!(error
            .to_string()
            .contains("unsupported Desktop settings version"));
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
                "version": 3,
                "provider": "deepseek",
                "model": model,
                "base_url": base_url
            });
            let (_root, storage) = storage_with_settings(&json.to_string());
            let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
                Ok(_) => panic!("blank settings field should fail"),
                Err(error) => error,
            };
            assert!(format!("{error:#}").contains(field));
        }
    }

    // Scenario: a version-3 Desktop settings file omits provider identity.
    // Expected: Desktop rejects the file instead of assigning its credential to DeepSeek.
    // Invariant: the fixed settings schema never synthesizes provider identity.
    #[test]
    fn desktop_version_three_settings_require_provider() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1"
            }"#,
        );
        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("version 3 provider is required"),
            Err(error) => error,
        };
        assert!(format!("{error:#}").contains("provider"));
    }

    // Scenario: a version-3 Desktop settings file omits an endpoint field.
    // Expected: Desktop rejects the incomplete fixed settings file.
    // Invariant: model and base URL remain explicit persisted Desktop facts.
    #[test]
    fn desktop_version_three_settings_require_model_and_base_url() {
        for missing_field in ["model", "base_url"] {
            let mut value = serde_json::json!({
                "version": 3,
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1"
            });
            value
                .as_object_mut()
                .expect("settings object")
                .remove(missing_field);
            let (_root, storage) = storage_with_settings(&value.to_string());
            let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
                Ok(_) => panic!("version 3 endpoint field is required"),
                Err(error) => error,
            };
            assert!(format!("{error:#}").contains(missing_field));
        }
    }

    // Scenario: the fixed application directory contains an old project-local settings schema.
    // Expected: Desktop rejects it with an explicit version error.
    // Invariant: legacy cwd-derived configuration is never silently reinterpreted as app config.
    #[test]
    fn desktop_rejects_legacy_project_settings_version() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 2,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "base_url": "https://api.deepseek.com"
            }"#,
        );
        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("legacy settings should fail"),
            Err(error) => error,
        };
        assert!(error
            .to_string()
            .contains("unsupported Desktop settings version 2"));
    }

    // Scenario: version-3 settings provide a relative project root.
    // Expected: Desktop rejects it before reading credentials or creating a runtime.
    // Invariant: the Agent workspace identity is explicit and independent of process cwd.
    #[test]
    fn desktop_settings_require_absolute_project_root() {
        let (_root, storage) = storage_with_settings(
            r#"{
                "version": 3,
                "project_root": "relative/project",
                "provider": "agnes",
                "model": "agnes-2.5-flash",
                "base_url": "https://api.agnes-ai.cn/v1"
            }"#,
        );
        let error = match build_agent_config_for_storage(&storage, &MapEnv(BTreeMap::new())) {
            Ok(_) => panic!("relative project root should fail"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("project_root must be absolute"));
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
