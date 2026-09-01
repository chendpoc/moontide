use std::collections::BTreeMap;
use std::fmt;

use anyhow::{bail, Result};

use super::credentials::api_key_env;
use super::{
    all_providers, resolve_endpoint, resolve_provider_config, ProviderId, ProviderOverrides,
    ResolveOverrides, ResolvedEndpoint, ResolvedProviderConfig,
};

const ENV_PROVIDER: &str = "MOONTIDE_PROVIDER";
const ENV_MODEL: &str = "MOONTIDE_MODEL";
const ENV_BASE_URL: &str = "MOONTIDE_BASE_URL";

/// One layer of optional LLM startup fields (`None` = not provided).
#[derive(Clone, Default, PartialEq, Eq)]
pub struct LlmConfigLayer {
    pub(crate) provider_id: Option<ProviderId>,
    pub(crate) model: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) api_key: Option<String>,
}

impl LlmConfigLayer {
    /// Construct one host layer, rejecting present-but-blank endpoint fields.
    pub fn new(
        provider_id: Option<ProviderId>,
        model: Option<String>,
        base_url: Option<String>,
        api_key: Option<String>,
    ) -> Result<Self> {
        Ok(Self {
            provider_id,
            model: validate_optional_non_empty(model, "model")?,
            base_url: validate_optional_non_empty(base_url, "base URL")?,
            api_key,
        })
    }
}

impl fmt::Debug for LlmConfigLayer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LlmConfigLayer")
            .field("provider_id", &self.provider_id)
            .field("model", &self.model)
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

/// Environment-derived layer plus every catalog-declared provider API key candidate.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct LlmEnvLayer {
    pub values: LlmConfigLayer,
    pub provider_api_keys: BTreeMap<ProviderId, String>,
}

impl fmt::Debug for LlmEnvLayer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LlmEnvLayer")
            .field("values", &self.values)
            .field(
                "provider_api_keys",
                &self
                    .provider_api_keys
                    .keys()
                    .map(|provider_id| (provider_id, "<redacted>"))
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

pub trait EnvSource {
    fn var(&self, name: &str) -> Option<String>;
}

/// Process environment accessor for production hosts.
pub struct ProcessEnv;

impl EnvSource for ProcessEnv {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}

/// Catalog preset for a provider (Layer 1 baseline).
pub fn catalog_preset(provider_id: ProviderId) -> ResolvedEndpoint {
    resolve_endpoint(
        provider_id,
        ResolveOverrides {
            base_url: None,
            model_id: None,
        },
    )
}

fn parse_non_empty(value: String, field: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{field} must not be empty");
    }
    Ok(trimmed.to_owned())
}

fn validate_optional_non_empty(value: Option<String>, field: &str) -> Result<Option<String>> {
    value.map(|value| parse_non_empty(value, field)).transpose()
}

/// Read Layer 3 values from the fixed env registry.
pub fn read_llm_env(env: &impl EnvSource) -> Result<LlmEnvLayer> {
    let provider_id = env
        .var(ENV_PROVIDER)
        .map(|raw| ProviderId::parse(&raw))
        .transpose()?;
    let values = LlmConfigLayer::new(provider_id, env.var(ENV_MODEL), env.var(ENV_BASE_URL), None)?;

    let mut provider_api_keys = BTreeMap::new();
    for entry in all_providers() {
        if let Some(raw) = env.var(entry.api_key_env()) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                provider_api_keys.insert(entry.id(), trimmed.to_owned());
            }
        }
    }

    Ok(LlmEnvLayer {
        values,
        provider_api_keys,
    })
}

fn merge_provider_id(
    settings: &LlmConfigLayer,
    environment: &LlmEnvLayer,
    host: &LlmConfigLayer,
) -> ProviderId {
    host.provider_id
        .or(environment.values.provider_id)
        .or(settings.provider_id)
        .unwrap_or_default()
}

fn layer_has_api_key(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|key| !key.trim().is_empty())
}

fn settings_apply_to_provider(settings: &LlmConfigLayer, provider_id: ProviderId) -> bool {
    settings.provider_id.unwrap_or_default() == provider_id
}

/// Which layer supplied the winning API key before host assembly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiKeySource {
    Host,
    Environment,
    Settings,
    Missing,
}

/// Resolve API key provenance using the same precedence as [`merge_startup_llm_config`].
pub fn resolve_api_key_source(
    settings: &LlmConfigLayer,
    environment: &LlmEnvLayer,
    host: &LlmConfigLayer,
) -> ApiKeySource {
    let final_provider = merge_provider_id(settings, environment, host);
    if layer_has_api_key(&host.api_key) {
        ApiKeySource::Host
    } else if environment.provider_api_keys.contains_key(&final_provider) {
        ApiKeySource::Environment
    } else if settings_apply_to_provider(settings, final_provider)
        && layer_has_api_key(&settings.api_key)
    {
        ApiKeySource::Settings
    } else {
        ApiKeySource::Missing
    }
}

fn apply_optional<T: Clone>(target: &mut Option<T>, layer: &Option<T>) {
    if let Some(value) = layer {
        *target = Some(value.clone());
    }
}

/// Pure four-layer merge: catalog → settings → environment → host.
pub fn merge_startup_llm_config(
    settings: &LlmConfigLayer,
    environment: &LlmEnvLayer,
    host: &LlmConfigLayer,
) -> Result<ResolvedProviderConfig> {
    validate_layer(settings)?;
    validate_layer(&environment.values)?;
    validate_layer(host)?;
    let final_provider = merge_provider_id(settings, environment, host);
    let preset = catalog_preset(final_provider);

    let mut model = Some(preset.model_id);
    let mut base_url = Some(preset.base_url);
    let mut api_key = None::<String>;

    if settings_apply_to_provider(settings, final_provider) {
        apply_optional(&mut model, &settings.model);
        apply_optional(&mut base_url, &settings.base_url);
        apply_optional(&mut api_key, &settings.api_key);
    }
    apply_optional(&mut model, &environment.values.model);
    apply_optional(&mut base_url, &environment.values.base_url);

    apply_optional(&mut model, &host.model);
    apply_optional(&mut base_url, &host.base_url);

    if let Some(env_key) = environment.provider_api_keys.get(&final_provider) {
        api_key = Some(env_key.clone());
    }
    apply_optional(&mut api_key, &host.api_key);

    Ok(resolve_provider_config(
        final_provider,
        ProviderOverrides {
            base_url: base_url.as_deref(),
            model: model.as_deref(),
            api_key: api_key.as_deref(),
        },
    ))
}

fn validate_layer(layer: &LlmConfigLayer) -> Result<()> {
    validate_optional_non_empty(layer.model.clone(), "model")?;
    validate_optional_non_empty(layer.base_url.clone(), "base URL")?;
    Ok(())
}

/// Non-empty API key from a merged config; error names the catalog env var.
pub fn require_api_key(config: &ResolvedProviderConfig) -> Result<&str> {
    if config.api_key.trim().is_empty() {
        bail!("{} is required", api_key_env(config.provider_id));
    }
    Ok(config.api_key.as_str())
}
