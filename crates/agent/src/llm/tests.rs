use super::*;
use std::collections::BTreeMap;

struct MapEnv(BTreeMap<&'static str, String>);

impl EnvSource for MapEnv {
    fn var(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}

// Scenario: API key provenance follows merge precedence without re-reading process env.
// Expected: host beats environment beats settings; missing layers yield Missing.
// Invariant: source resolution mirrors merge field order only.
#[test]
fn resolve_api_key_source_follows_merge_precedence() {
    let settings = LlmConfigLayer {
        provider_id: Some(ProviderId::Deepseek),
        api_key: Some("settings-key".into()),
        ..Default::default()
    };
    let mut provider_api_keys = BTreeMap::new();
    provider_api_keys.insert(ProviderId::Deepseek, "env-key".into());
    let environment = LlmEnvLayer {
        provider_api_keys,
        ..Default::default()
    };
    let host = LlmConfigLayer {
        api_key: Some("host-key".into()),
        ..Default::default()
    };

    assert_eq!(
        resolve_api_key_source(&settings, &environment, &host),
        ApiKeySource::Host
    );
    assert_eq!(
        resolve_api_key_source(&settings, &environment, &LlmConfigLayer::default()),
        ApiKeySource::Environment
    );
    assert_eq!(
        resolve_api_key_source(
            &settings,
            &LlmEnvLayer::default(),
            &LlmConfigLayer::default()
        ),
        ApiKeySource::Settings
    );
    assert_eq!(
        resolve_api_key_source(
            &LlmConfigLayer::default(),
            &LlmEnvLayer::default(),
            &LlmConfigLayer::default()
        ),
        ApiKeySource::Missing
    );
}

// Scenario: settings, environment, and host each provide an Agnes model.
// Expected: host model wins over env and settings.
// Invariant: merge is field-wise and does not re-read process environment.
#[test]
fn merge_host_model_overrides_lower_layers() {
    let provider = ProviderId::Agnes;
    let settings = LlmConfigLayer {
        provider_id: Some(provider),
        model: Some("agnes-2.0-flash".into()),
        ..Default::default()
    };
    let environment = LlmEnvLayer {
        values: LlmConfigLayer {
            model: Some("agnes-2.5-pro".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    let host = LlmConfigLayer {
        model: Some("agnes-2.5-flash".into()),
        ..Default::default()
    };

    let merged = merge_startup_llm_config(&settings, &environment, &host).expect("merge");
    assert_eq!(merged.model, "agnes-2.5-flash");
}

// Scenario: settings and env provide model, host omits model.
// Expected: env model overrides settings.
// Invariant: catalog normalization runs after field merge.
#[test]
fn merge_env_model_overrides_settings() {
    let settings = LlmConfigLayer {
        provider_id: Some(ProviderId::Agnes),
        model: Some("agnes-2.0-flash".into()),
        ..Default::default()
    };
    let environment = LlmEnvLayer {
        values: LlmConfigLayer {
            model: Some("agnes-2.5-pro".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    let merged = merge_startup_llm_config(&settings, &environment, &LlmConfigLayer::default())
        .expect("merge");
    assert_eq!(merged.model, "agnes-2.5-pro");
}

// Scenario: only settings provides base URL.
// Expected: settings base URL is preserved through catalog normalization.
// Invariant: empty higher layers do not erase lower explicit values.
#[test]
fn merge_settings_base_url_persists_without_higher_layers() {
    let settings = LlmConfigLayer {
        base_url: Some("https://settings.example".into()),
        ..Default::default()
    };
    let merged = merge_startup_llm_config(
        &settings,
        &LlmEnvLayer::default(),
        &LlmConfigLayer::default(),
    )
    .expect("merge");
    assert_eq!(merged.base_url, "https://settings.example");
}

// Scenario: all higher layers are empty.
// Expected: provider/model/base URL/family come entirely from catalog preset.
// Invariant: Layer 1 is always applied inside merge, not by hosts.
#[test]
fn merge_empty_layers_use_catalog_preset() {
    let merged = merge_startup_llm_config(
        &LlmConfigLayer::default(),
        &LlmEnvLayer::default(),
        &LlmConfigLayer::default(),
    )
    .expect("merge");
    let preset = catalog_preset(ProviderId::default());
    assert_eq!(merged.provider_id, ProviderId::default());
    assert_eq!(merged.model, preset.model_id);
    assert_eq!(merged.base_url, preset.base_url);
    assert_eq!(merged.family, preset.family);
    assert!(merged.api_key.is_empty());
}

// Scenario: settings, env, and host each supply an API key for the final provider.
// Expected: host key wins, then env, then settings.
// Invariant: only the final provider's env candidate participates in merge.
#[test]
fn merge_api_key_precedence_settings_env_host() {
    let settings = LlmConfigLayer {
        provider_id: Some(ProviderId::Deepseek),
        api_key: Some("settings-key".into()),
        ..Default::default()
    };
    let mut provider_api_keys = BTreeMap::new();
    provider_api_keys.insert(ProviderId::Deepseek, "env-key".into());
    provider_api_keys.insert(ProviderId::Agnes, "agnes-env-key".into());
    let environment = LlmEnvLayer {
        provider_api_keys,
        ..Default::default()
    };
    let host = LlmConfigLayer {
        api_key: Some("host-key".into()),
        ..Default::default()
    };
    let merged = merge_startup_llm_config(&settings, &environment, &host).expect("merge");
    assert_eq!(merged.api_key, "host-key");

    let merged = merge_startup_llm_config(&settings, &environment, &LlmConfigLayer::default())
        .expect("merge");
    assert_eq!(merged.api_key, "env-key");

    let merged = merge_startup_llm_config(
        &settings,
        &LlmEnvLayer::default(),
        &LlmConfigLayer::default(),
    )
    .expect("merge");
    assert_eq!(merged.api_key, "settings-key");
}

// Scenario: final provider is Agnes while both provider key env candidates exist.
// Expected: only Agnes env candidate is selected.
// Invariant: env keys do not switch provider by themselves.
#[test]
fn merge_agnes_provider_uses_agnes_env_key_only() {
    let settings = LlmConfigLayer {
        provider_id: Some(ProviderId::Agnes),
        ..Default::default()
    };
    let mut provider_api_keys = BTreeMap::new();
    provider_api_keys.insert(ProviderId::Deepseek, "deepseek-key".into());
    provider_api_keys.insert(ProviderId::Agnes, "agnes-key".into());
    let environment = LlmEnvLayer {
        provider_api_keys,
        ..Default::default()
    };
    let merged = merge_startup_llm_config(&settings, &environment, &LlmConfigLayer::default())
        .expect("merge");
    assert_eq!(merged.provider_id, ProviderId::Agnes);
    assert_eq!(merged.api_key, "agnes-key");
}

// Scenario: MOONTIDE_PROVIDER receives an unknown label.
// Expected: env read fails with an explicit provider parse error.
// Invariant: unknown providers never silently fall back to DeepSeek during env parse.
#[test]
fn read_llm_env_rejects_unknown_provider() {
    let env = MapEnv(BTreeMap::from([("MOONTIDE_PROVIDER", "openrouter".into())]));
    let error = read_llm_env(&env).expect_err("unknown provider");
    assert!(error.to_string().contains("unknown provider"));
}

// Scenario: an external host attempts to construct a layer with a blank endpoint field.
// Expected: the fallible constructor rejects both blank model and blank base URL.
// Invariant: public layer construction cannot create present-but-blank endpoint overrides.
#[test]
fn llm_config_layer_constructor_rejects_blank_endpoint_fields() {
    assert!(LlmConfigLayer::new(None, Some("  ".into()), None, None).is_err());
    assert!(LlmConfigLayer::new(None, None, Some("\t".into()), None).is_err());
}

// Scenario: an environment layer containing provider credentials is formatted for diagnostics.
// Expected: provider identity remains visible while raw keys are redacted.
// Invariant: secret-bearing startup layers never disclose credentials via Debug.
#[test]
fn llm_env_layer_debug_redacts_provider_keys() {
    let layer = LlmEnvLayer {
        values: LlmConfigLayer::default(),
        provider_api_keys: BTreeMap::from([(ProviderId::Agnes, "super-secret".into())]),
    };
    let debug = format!("{layer:?}");
    assert!(!debug.contains("super-secret"));
    assert!(debug.contains("<redacted>"));
}

// Scenario: catalog endpoint resolves for Agnes with host-supplied credentials.
// Expected: family, base URL, and model come from catalog; api_key is attached unchanged.
// Invariant: resolution does not read environment variables.
#[test]
fn resolve_provider_config_attaches_credentials_to_catalog_endpoint() {
    let resolved = resolve_provider_config(
        ProviderId::Agnes,
        ProviderOverrides {
            base_url: None,
            model: None,
            api_key: Some("secret"),
        },
    );

    assert_eq!(resolved.provider_id, ProviderId::Agnes);
    assert_eq!(resolved.model, "agnes-2.5-flash");
    assert_eq!(resolved.base_url, "https://api.agnes-ai.cn/v1");
    assert_eq!(resolved.api_key, "secret");
    assert_eq!(resolved.family, AdapterFamily::OpenAiChatCompletions);
    assert_eq!(
        resolved.openai_chat.thinking_extension,
        OpenAiThinkingExtension::ChatTemplateKwargs
    );
}

// Scenario: apply_provider_switch is reachable through the host-facing llm module.
// Expected: switching provider resets model and base URL to catalog defaults.
// Invariant: agent::llm is the only host import path for catalog mutation helpers.
#[test]
fn apply_provider_switch_resets_model_and_base_url() {
    let mut model = "deepseek-chat".to_owned();
    let mut base_url = "https://api.deepseek.com".to_owned();
    let mut api_key = "old".to_owned();
    apply_provider_switch(
        ProviderId::Agnes,
        &mut model,
        &mut base_url,
        true,
        &mut api_key,
    );
    assert_eq!(model, "agnes-2.5-flash");
    assert_eq!(base_url, "https://api.agnes-ai.cn/v1");
    assert!(api_key.is_empty());
}

// Scenario: persisted DeepSeek fields are followed by an environment switch to Agnes.
// Expected: the resolved value uses Agnes defaults and Agnes's environment credential only.
// Invariant: lower-layer model, endpoint, and secret never cross provider scope.
#[test]
fn merge_provider_switch_discards_lower_provider_bundle() {
    let settings = LlmConfigLayer {
        provider_id: Some(ProviderId::Deepseek),
        model: Some("deepseek-chat".into()),
        base_url: Some("https://deepseek-settings.example".into()),
        api_key: Some("deepseek-settings-key".into()),
    };
    let environment = LlmEnvLayer {
        values: LlmConfigLayer {
            provider_id: Some(ProviderId::Agnes),
            ..Default::default()
        },
        provider_api_keys: BTreeMap::from([
            (ProviderId::Deepseek, "deepseek-env-key".into()),
            (ProviderId::Agnes, "agnes-env-key".into()),
        ]),
    };

    let merged = merge_startup_llm_config(&settings, &environment, &LlmConfigLayer::default())
        .expect("merge");

    assert_eq!(merged.provider_id, ProviderId::Agnes);
    assert_eq!(merged.model, "agnes-2.5-flash");
    assert_eq!(merged.base_url, "https://api.agnes-ai.cn/v1");
    assert_eq!(merged.api_key, "agnes-env-key");
    assert_eq!(
        merged.openai_chat.thinking_extension,
        OpenAiThinkingExtension::ChatTemplateKwargs
    );
}

// Scenario: host selects Agnes while only DeepSeek settings and env credentials exist.
// Expected: Agnes resolves with its defaults and no credential.
// Invariant: a provider switch fails closed instead of reusing another provider's secret.
#[test]
fn merge_host_provider_switch_does_not_reuse_lower_credentials() {
    let settings = LlmConfigLayer {
        provider_id: Some(ProviderId::Deepseek),
        api_key: Some("settings-key".into()),
        ..Default::default()
    };
    let environment = LlmEnvLayer {
        provider_api_keys: BTreeMap::from([(ProviderId::Deepseek, "env-key".into())]),
        ..Default::default()
    };
    let host = LlmConfigLayer {
        provider_id: Some(ProviderId::Agnes),
        ..Default::default()
    };

    let merged = merge_startup_llm_config(&settings, &environment, &host).expect("merge");
    assert_eq!(merged.provider_id, ProviderId::Agnes);
    assert_eq!(merged.model, "agnes-2.5-flash");
    assert_eq!(merged.base_url, "https://api.agnes-ai.cn/v1");
    assert!(merged.api_key.is_empty());
    assert!(require_api_key(&merged).is_err());
    assert_eq!(
        resolve_api_key_source(&settings, &environment, &host),
        ApiKeySource::Missing
    );
}

// Scenario: a secret-bearing resolved provider is rendered for diagnostics.
// Expected: provider facts are visible while the raw API key is absent.
// Invariant: deriving or formatting runtime config cannot disclose credentials.
#[test]
fn resolved_provider_debug_redacts_api_key() {
    let resolved = resolve_provider_config(
        ProviderId::Deepseek,
        ProviderOverrides {
            base_url: None,
            model: None,
            api_key: Some("super-secret"),
        },
    );
    let debug = format!("{resolved:?}");
    assert!(!debug.contains("super-secret"));
    assert!(debug.contains("<redacted>"));
}
