//! Concrete provider/model catalog owned by the agent composition root.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::OnceLock;

use agent_core::llm::adapter_family::AdapterFamily;
use agent_core::llm::normalize::openai_chat::{
    OpenAiChatOptions,
    OpenAiThinkingExtension,
};
use agent_core::llm::profile_config::{
    AdapterOptions,
    AnthropicMessagesOptions,
    ClampDiagnostic,
    GoogleGenerativeAiOptions,
    HostProtocolProfileOverride,
    OpenAiResponsesOptions,
    ProtocolFeatureConfig,
    ProtocolFeatureSet,
    ResolvedProtocolProfile,
    UserProtocolProfileOverride,
    WireDecodeConfig,
    WireEncodeConfig,
    WireHttpConfig,
    WireProfileConfig,
};
use anyhow::{
    bail,
    Result,
};
use serde::Deserialize;

use super::profile::{
    merge_protocol_profile,
    ProviderProtocolProfileDefault,
};
use super::provider_id::ProviderId;

/// One catalog model suggestion (id/label/thinking only; protocol lives on provider).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LlmModel {
    pub id: &'static str,
    pub label: &'static str,
    pub supports_thinking: bool,
}

/// Provider metadata with owned model slice and protocol profile defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderEntry {
    id: ProviderId,
    api_key_env: &'static str,
    default_base_url: &'static str,
    default_protocol: AdapterFamily,
    supported_protocols: &'static [AdapterFamily],
    profile_defaults: &'static [ProviderProtocolProfileDefault],
    models: &'static [LlmModel],
}

impl ProviderEntry {
    pub fn id(&self) -> ProviderId {
        self.id.clone()
    }

    pub fn api_key_env(&self) -> &'static str {
        self.api_key_env
    }

    pub fn default_base_url(&self) -> &'static str {
        self.default_base_url
    }

    pub fn default_protocol(&self) -> AdapterFamily {
        self.default_protocol
    }

    pub fn supported_protocols(&self) -> &'static [AdapterFamily] {
        self.supported_protocols
    }

    pub fn profile_defaults(&self) -> &'static [ProviderProtocolProfileDefault] {
        match self.id {
            ProviderId::Agnes => agnes_profiles(),
            _ => self.profile_defaults,
        }
    }

    pub fn models(&self) -> &'static [LlmModel] {
        self.models
    }

    pub fn default_model_id(&self) -> &'static str {
        self.default_model().id
    }

    fn default_model(&self) -> &'static LlmModel {
        match self.id {
            ProviderId::Deepseek => &DEEPSEEK_V4_FLASH,
            ProviderId::Agnes => &AGNES_25_FLASH,
            ProviderId::Openai => &OPENAI_GPT41,
            ProviderId::Anthropic => &ANTHROPIC_SONNET,
            ProviderId::Google => &GOOGLE_GEMINI_FLASH,
            ProviderId::Custom(_) => {
                // `register_custom_providers` validates at least one model per custom row.
                &self.models[0]
            }
        }
    }

    pub fn profile_default_for(
        &self,
        protocol: AdapterFamily,
    ) -> Option<&'static ProviderProtocolProfileDefault> {
        self.profile_defaults()
            .iter()
            .find(|profile| profile.protocol == protocol)
    }
}

const DEEPSEEK_V4_FLASH: LlmModel = LlmModel {
    id: "deepseek-v4-flash",
    label: "deepseek-v4-flash",
    supports_thinking: true,
};

const DEEPSEEK_CHAT: LlmModel = LlmModel {
    id: "deepseek-chat",
    label: "deepseek-chat",
    supports_thinking: true,
};

const AGNES_25_FLASH: LlmModel = LlmModel {
    id: "agnes-2.5-flash",
    label: "agnes-2.5-flash (agent)",
    supports_thinking: true,
};

const AGNES_20_FLASH: LlmModel = LlmModel {
    id: "agnes-2.0-flash",
    label: "agnes-2.0-flash",
    supports_thinking: true,
};

const AGNES_25_PRO: LlmModel = LlmModel {
    id: "agnes-2.5-pro",
    label: "agnes-2.5-pro",
    supports_thinking: true,
};

const OPENAI_GPT41: LlmModel = LlmModel {
    id: "gpt-4.1",
    label: "gpt-4.1",
    supports_thinking: false,
};

const ANTHROPIC_SONNET: LlmModel = LlmModel {
    id: "claude-sonnet-4-20250514",
    label: "claude-sonnet-4-20250514",
    supports_thinking: true,
};

const GOOGLE_GEMINI_FLASH: LlmModel = LlmModel {
    id: "gemini-2.0-flash",
    label: "gemini-2.0-flash",
    supports_thinking: false,
};

const DEEPSEEK_MODELS: &[LlmModel] = &[DEEPSEEK_V4_FLASH, DEEPSEEK_CHAT];
const AGNES_MODELS: &[LlmModel] = &[AGNES_25_FLASH, AGNES_20_FLASH, AGNES_25_PRO];
const OPENAI_MODELS: &[LlmModel] = &[OPENAI_GPT41];
const ANTHROPIC_MODELS: &[LlmModel] = &[ANTHROPIC_SONNET];
const GOOGLE_MODELS: &[LlmModel] = &[GOOGLE_GEMINI_FLASH];

const DEEPSEEK_SUPPORTED: &[AdapterFamily] = &[
    AdapterFamily::OpenAiResponses,
    AdapterFamily::OpenAiChatCompletions,
];
const AGNES_SUPPORTED: &[AdapterFamily] = &[
    AdapterFamily::OpenAiResponses,
    AdapterFamily::OpenAiChatCompletions,
    AdapterFamily::AnthropicMessages,
];
const OPENAI_SUPPORTED: &[AdapterFamily] = &[
    AdapterFamily::OpenAiResponses,
    AdapterFamily::OpenAiChatCompletions,
];
const ANTHROPIC_SUPPORTED: &[AdapterFamily] = &[AdapterFamily::AnthropicMessages];
const GOOGLE_SUPPORTED: &[AdapterFamily] = &[AdapterFamily::GoogleGenerativeAi];

const BASE_STREAMING_TOOLS_THINKING: ProtocolFeatureSet =
    ProtocolFeatureSet::from_bits_truncate(0b111);

const CEILING_WITH_PREVIOUS_ID: ProtocolFeatureSet =
    ProtocolFeatureSet::from_bits_truncate(0b111 | (1 << 9));

const CEILING_WITH_PROMPT_CACHE: ProtocolFeatureSet =
    ProtocolFeatureSet::from_bits_truncate(0b111 | (1 << 16));

const ENABLED_RESPONSES_STORE_PREVIOUS: ProtocolFeatureSet =
    ProtocolFeatureSet::from_bits_truncate(0b111 | (1 << 8) | (1 << 9));

const CEILING_OPENAI_RESPONSES: ProtocolFeatureSet =
    ProtocolFeatureSet::from_bits_truncate(0b111 | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11));

const ENABLED_GOOGLE_DEFAULT: ProtocolFeatureSet = ProtocolFeatureSet::from_bits_truncate(0b1011);

const WIRE_EMPTY: WireProfileConfig = WireProfileConfig {
    encode: WireEncodeConfig {},
    decode: WireDecodeConfig {
        output_text_path: None,
        reasoning_delta_field: None,
    },
    http: WireHttpConfig {
        prefer_websocket: None,
    },
};

const DEEPSEEK_RESPONSES_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Deepseek,
    protocol: AdapterFamily::OpenAiResponses,
    features: ProtocolFeatureConfig {
        enabled: BASE_STREAMING_TOOLS_THINKING,
    },
    wire: WireProfileConfig {
        decode: WireDecodeConfig {
            output_text_path: None,
            reasoning_delta_field: None,
        },
        encode: WireEncodeConfig {},
        http: WireHttpConfig {
            prefer_websocket: None,
        },
    },
    default_options: AdapterOptions::OpenAiResponses(OpenAiResponsesOptions {}),
    vendor_ceiling: CEILING_WITH_PREVIOUS_ID,
};

const DEEPSEEK_CHAT_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Deepseek,
    protocol: AdapterFamily::OpenAiChatCompletions,
    features: ProtocolFeatureConfig {
        enabled: BASE_STREAMING_TOOLS_THINKING,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::OpenAiChat(OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::None,
    }),
    vendor_ceiling: BASE_STREAMING_TOOLS_THINKING,
};

fn agnes_responses_profile() -> &'static ProviderProtocolProfileDefault {
    static PROFILE: OnceLock<ProviderProtocolProfileDefault> = OnceLock::new();
    PROFILE.get_or_init(|| ProviderProtocolProfileDefault {
        provider_id: ProviderId::Agnes,
        protocol: AdapterFamily::OpenAiResponses,
        features: ProtocolFeatureConfig {
            enabled: BASE_STREAMING_TOOLS_THINKING,
        },
        wire: WireProfileConfig {
            encode: WireEncodeConfig {},
            decode: WireDecodeConfig {
                output_text_path: Some("output_items".into()),
                reasoning_delta_field: None,
            },
            http: WireHttpConfig {
                prefer_websocket: None,
            },
        },
        default_options: AdapterOptions::OpenAiResponses(OpenAiResponsesOptions {}),
        vendor_ceiling: CEILING_WITH_PREVIOUS_ID,
    })
}

const AGNES_CHAT_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Agnes,
    protocol: AdapterFamily::OpenAiChatCompletions,
    features: ProtocolFeatureConfig {
        enabled: BASE_STREAMING_TOOLS_THINKING,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::OpenAiChat(OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::ChatTemplateKwargs,
    }),
    vendor_ceiling: BASE_STREAMING_TOOLS_THINKING,
};

const AGNES_MESSAGES_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Agnes,
    protocol: AdapterFamily::AnthropicMessages,
    features: ProtocolFeatureConfig {
        enabled: BASE_STREAMING_TOOLS_THINKING,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::AnthropicMessages(AnthropicMessagesOptions {
        prompt_cache: false,
    }),
    vendor_ceiling: CEILING_WITH_PROMPT_CACHE,
};

const OPENAI_RESPONSES_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Openai,
    protocol: AdapterFamily::OpenAiResponses,
    features: ProtocolFeatureConfig {
        enabled: ENABLED_RESPONSES_STORE_PREVIOUS,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::OpenAiResponses(OpenAiResponsesOptions {}),
    vendor_ceiling: CEILING_OPENAI_RESPONSES,
};

const OPENAI_CHAT_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Openai,
    protocol: AdapterFamily::OpenAiChatCompletions,
    features: ProtocolFeatureConfig {
        enabled: BASE_STREAMING_TOOLS_THINKING,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::OpenAiChat(OpenAiChatOptions {
        thinking_extension: OpenAiThinkingExtension::None,
    }),
    vendor_ceiling: BASE_STREAMING_TOOLS_THINKING,
};

const ANTHROPIC_MESSAGES_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Anthropic,
    protocol: AdapterFamily::AnthropicMessages,
    features: ProtocolFeatureConfig {
        enabled: BASE_STREAMING_TOOLS_THINKING,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::AnthropicMessages(AnthropicMessagesOptions {
        prompt_cache: false,
    }),
    vendor_ceiling: CEILING_WITH_PROMPT_CACHE,
};

const GOOGLE_GENERATIVE_PROFILE: ProviderProtocolProfileDefault = ProviderProtocolProfileDefault {
    provider_id: ProviderId::Google,
    protocol: AdapterFamily::GoogleGenerativeAi,
    features: ProtocolFeatureConfig {
        enabled: ENABLED_GOOGLE_DEFAULT,
    },
    wire: WIRE_EMPTY,
    default_options: AdapterOptions::GoogleGenerativeAi(GoogleGenerativeAiOptions {}),
    vendor_ceiling: ENABLED_GOOGLE_DEFAULT,
};

const DEEPSEEK_PROFILES: &[ProviderProtocolProfileDefault] =
    &[DEEPSEEK_RESPONSES_PROFILE, DEEPSEEK_CHAT_PROFILE];
static AGNES_PROFILES: OnceLock<[ProviderProtocolProfileDefault; 3]> = OnceLock::new();

fn agnes_profiles() -> &'static [ProviderProtocolProfileDefault; 3] {
    AGNES_PROFILES.get_or_init(|| {
        [
            agnes_responses_profile().clone(),
            AGNES_CHAT_PROFILE,
            AGNES_MESSAGES_PROFILE,
        ]
    })
}
const OPENAI_PROFILES: &[ProviderProtocolProfileDefault] =
    &[OPENAI_RESPONSES_PROFILE, OPENAI_CHAT_PROFILE];
const ANTHROPIC_PROFILES: &[ProviderProtocolProfileDefault] = &[ANTHROPIC_MESSAGES_PROFILE];
const GOOGLE_PROFILES: &[ProviderProtocolProfileDefault] = &[GOOGLE_GENERATIVE_PROFILE];

static DEEPSEEK_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Deepseek,
    api_key_env: "DEEPSEEK_API_KEY",
    default_base_url: "https://api.deepseek.com",
    default_protocol: AdapterFamily::OpenAiResponses,
    supported_protocols: DEEPSEEK_SUPPORTED,
    profile_defaults: DEEPSEEK_PROFILES,
    models: DEEPSEEK_MODELS,
};

static AGNES_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Agnes,
    api_key_env: "AGNES_API_KEY",
    default_base_url: "https://api.agnes-ai.cn/v1",
    default_protocol: AdapterFamily::OpenAiResponses,
    supported_protocols: AGNES_SUPPORTED,
    profile_defaults: &[],
    models: AGNES_MODELS,
};

static OPENAI_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Openai,
    api_key_env: "OPENAI_API_KEY",
    default_base_url: "https://api.openai.com/v1",
    default_protocol: AdapterFamily::OpenAiResponses,
    supported_protocols: OPENAI_SUPPORTED,
    profile_defaults: OPENAI_PROFILES,
    models: OPENAI_MODELS,
};

static ANTHROPIC_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Anthropic,
    api_key_env: "ANTHROPIC_API_KEY",
    default_base_url: "https://api.anthropic.com",
    default_protocol: AdapterFamily::AnthropicMessages,
    supported_protocols: ANTHROPIC_SUPPORTED,
    profile_defaults: ANTHROPIC_PROFILES,
    models: ANTHROPIC_MODELS,
};

static GOOGLE_PROVIDER: ProviderEntry = ProviderEntry {
    id: ProviderId::Google,
    api_key_env: "GOOGLE_API_KEY",
    default_base_url: "https://generativelanguage.googleapis.com/v1beta",
    default_protocol: AdapterFamily::GoogleGenerativeAi,
    supported_protocols: GOOGLE_SUPPORTED,
    profile_defaults: GOOGLE_PROFILES,
    models: GOOGLE_MODELS,
};

/// User-declared provider loaded from host settings at startup.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CustomProviderDefinition {
    pub display_name: String,
    pub protocol: AdapterFamily,
    pub base_url: String,
    pub api_key_env: String,
    pub profile_template: String,
    #[serde(default)]
    pub profile: Option<UserProtocolProfileOverride>,
    #[serde(default)]
    pub models: Vec<String>,
}

struct CustomProviderStorage {
    entry: ProviderEntry,
}

static CUSTOM_PROVIDERS: OnceLock<BTreeMap<String, CustomProviderStorage>> = OnceLock::new();

fn profile_template_default(template: &str) -> Result<&'static ProviderProtocolProfileDefault> {
    let protocol = AdapterFamily::parse(template)
        .ok_or_else(|| anyhow::anyhow!("unknown profile_template protocol: {template}"))?;
    let entry = match protocol {
        AdapterFamily::OpenAiChatCompletions => &OPENAI_PROVIDER,
        AdapterFamily::OpenAiResponses => &OPENAI_PROVIDER,
        AdapterFamily::AnthropicMessages => &ANTHROPIC_PROVIDER,
        AdapterFamily::GoogleGenerativeAi => &GOOGLE_PROVIDER,
    };
    entry
        .profile_default_for(protocol)
        .ok_or_else(|| anyhow::anyhow!("catalog missing profile template default for {template}"))
}

fn build_custom_provider(
    slug: &str,
    def: CustomProviderDefinition,
) -> Result<CustomProviderStorage> {
    if ProviderId::parse(slug)?.is_builtin() {
        bail!("custom provider slug conflicts with built-in provider: {slug}");
    }
    let template = profile_template_default(&def.profile_template)?;
    let mut profile_default = template.clone();
    profile_default.provider_id = ProviderId::Custom(Cow::Owned(slug.to_owned()));
    profile_default.protocol = def.protocol;
    if let Some(profile) = def.profile {
        let (merged, _) = merge_protocol_profile(&profile_default, Some(&profile), None);
        profile_default.features = merged.features;
        profile_default.wire = merged.wire;
        profile_default.default_options = merged.options;
    }

    let model_ids = if def.models.is_empty() {
        vec!["default".to_owned()]
    } else {
        def.models
    };
    let models: Vec<LlmModel> = model_ids
        .iter()
        .map(|id| LlmModel {
            id: Box::leak(id.clone().into_boxed_str()),
            label: Box::leak(format!("{id} (custom)").into_boxed_str()),
            supports_thinking: false,
        })
        .collect();

    let entry = ProviderEntry {
        id: ProviderId::Custom(Cow::Owned(slug.to_owned())),
        api_key_env: Box::leak(def.api_key_env.into_boxed_str()),
        default_base_url: Box::leak(def.base_url.into_boxed_str()),
        default_protocol: def.protocol,
        supported_protocols: Box::leak(Box::new([def.protocol])),
        profile_defaults: Box::leak(Box::new([profile_default])),
        models: Box::leak(models.into_boxed_slice()),
    };

    Ok(CustomProviderStorage { entry })
}

/// Register custom providers declared by CLI/Desktop settings.
pub fn register_custom_providers(defs: BTreeMap<String, CustomProviderDefinition>) -> Result<()> {
    if CUSTOM_PROVIDERS.get().is_some() || defs.is_empty() {
        return Ok(());
    }
    let mut registry = BTreeMap::new();
    for (slug, def) in defs {
        let storage = build_custom_provider(&slug, def)?;
        registry.insert(slug, storage);
    }
    CUSTOM_PROVIDERS
        .set(registry)
        .map_err(|_| anyhow::anyhow!("custom providers already registered"))
}

fn custom_provider(slug: &str) -> Option<&'static ProviderEntry> {
    CUSTOM_PROVIDERS
        .get()?
        .get(slug)
        .map(|storage| &storage.entry)
}

pub fn provider(id: ProviderId) -> Result<&'static ProviderEntry> {
    match id {
        ProviderId::Deepseek => Ok(&DEEPSEEK_PROVIDER),
        ProviderId::Agnes => Ok(&AGNES_PROVIDER),
        ProviderId::Openai => Ok(&OPENAI_PROVIDER),
        ProviderId::Anthropic => Ok(&ANTHROPIC_PROVIDER),
        ProviderId::Google => Ok(&GOOGLE_PROVIDER),
        ProviderId::Custom(slug) => custom_provider(slug.as_ref())
            .ok_or_else(|| anyhow::anyhow!("custom provider is not registered: {slug}")),
    }
}

pub fn all_providers() -> [&'static ProviderEntry; 5] {
    [
        &DEEPSEEK_PROVIDER,
        &AGNES_PROVIDER,
        &OPENAI_PROVIDER,
        &ANTHROPIC_PROVIDER,
        &GOOGLE_PROVIDER,
    ]
}

/// Custom providers registered at host startup (empty until [`register_custom_providers`]).
pub fn custom_provider_entries() -> Vec<&'static ProviderEntry> {
    CUSTOM_PROVIDERS
        .get()
        .map(|registry| registry.values().map(|storage| &storage.entry).collect())
        .unwrap_or_default()
}

/// Built-in and registered custom provider ids for host settings UI.
pub fn list_provider_ids() -> Vec<ProviderId> {
    let mut ids: Vec<_> = all_providers().iter().map(|entry| entry.id()).collect();
    if let Some(registry) = CUSTOM_PROVIDERS.get() {
        for slug in registry.keys() {
            ids.push(ProviderId::Custom(Cow::Owned(slug.clone())));
        }
    }
    ids
}

pub fn models_for(provider_id: ProviderId) -> Result<&'static [LlmModel]> {
    Ok(provider(provider_id)?.models())
}

pub fn get_model(provider_id: ProviderId, model_id: &str) -> Result<Option<&'static LlmModel>> {
    Ok(models_for(provider_id)?
        .iter()
        .find(|model| model.id == model_id))
}

pub struct ResolveOverrides<'a> {
    pub base_url: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub protocol: Option<AdapterFamily>,
    pub user_profile: Option<&'a UserProtocolProfileOverride>,
    pub host_profile: Option<&'a HostProtocolProfileOverride>,
}

/// Provider defaults after catalog model, protocol, and endpoint normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEndpoint {
    pub provider_id: ProviderId,
    pub model_id: String,
    pub protocol: AdapterFamily,
    pub base_url: String,
    pub profile: ResolvedProtocolProfile,
    pub profile_clamp_diagnostics: Vec<ClampDiagnostic>,
}

/// One indivisible runtime provider fact, including credentials and merged profile.
#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedProviderConfig {
    pub provider_id: ProviderId,
    pub model: String,
    pub protocol: AdapterFamily,
    pub profile: ResolvedProtocolProfile,
    pub base_url: String,
    pub api_key: String,
    pub profile_clamp_diagnostics: Vec<ClampDiagnostic>,
}

impl fmt::Debug for ResolvedProviderConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResolvedProviderConfig")
            .field("provider_id", &self.provider_id)
            .field("model", &self.model)
            .field("protocol", &self.protocol)
            .field("profile", &self.profile)
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl ResolvedProviderConfig {
    pub fn to_call_config(
        &self,
        max_tokens: u32,
        thinking_level: Option<agent_core::llm::protocol::ThinkingLevel>,
        session_id: Option<String>,
        continuity_hint: agent_core::llm::profile_config::ContinuityHint,
    ) -> agent_core::model_input::LlmCallConfig {
        agent_core::model_input::LlmCallConfig {
            protocol: self.protocol,
            profile: self.profile.clone(),
            model: self.model.clone(),
            base_url: self.base_url.clone(),
            api_key: self.api_key.clone(),
            max_tokens,
            thinking_level,
            session_id,
            continuity_hint,
        }
    }

    pub fn openai_chat_options(&self) -> OpenAiChatOptions {
        match self.profile.options {
            AdapterOptions::OpenAiChat(options) => options,
            _ => OpenAiChatOptions::default(),
        }
    }
}

pub struct ProviderOverrides<'a> {
    pub base_url: Option<&'a str>,
    pub model: Option<&'a str>,
    pub api_key: Option<&'a str>,
    pub protocol: Option<AdapterFamily>,
    pub user_profile: Option<&'a UserProtocolProfileOverride>,
    pub host_profile: Option<&'a HostProtocolProfileOverride>,
}

fn resolve_protocol(
    entry: &ProviderEntry,
    overrides: &ResolveOverrides<'_>,
) -> Result<AdapterFamily> {
    let requested = overrides
        .protocol
        .or_else(|| overrides.user_profile.and_then(|profile| profile.protocol))
        .or_else(|| overrides.host_profile.and_then(|profile| profile.protocol))
        .unwrap_or(entry.default_protocol());
    if entry.supported_protocols().contains(&requested) {
        Ok(requested)
    } else {
        bail!(
            "protocol {} is not supported for provider {}",
            requested.as_str(),
            entry.id().as_str()
        )
    }
}

fn resolve_profile(
    entry: &ProviderEntry,
    protocol: AdapterFamily,
    overrides: &ResolveOverrides<'_>,
) -> Result<(ResolvedProtocolProfile, Vec<ClampDiagnostic>)> {
    let default = entry.profile_default_for(protocol).ok_or_else(|| {
        anyhow::anyhow!(
            "catalog missing profile default for {} / {}",
            entry.id().as_str(),
            protocol.as_str()
        )
    })?;
    let (profile, diagnostics) =
        merge_protocol_profile(default, overrides.user_profile, overrides.host_profile);
    Ok((profile, diagnostics))
}

/// Resolve `(provider, model, protocol)` into fixed adapter defaults without credentials.
pub fn resolve_endpoint(
    provider_id: ProviderId,
    overrides: ResolveOverrides<'_>,
) -> Result<ResolvedEndpoint> {
    let entry = provider(provider_id.clone())?;
    let default_model = entry.default_model();
    let requested_model = overrides.model_id.unwrap_or(default_model.id);
    let _catalog_model = get_model(provider_id.clone(), requested_model)?;
    let protocol = resolve_protocol(entry, &overrides)?;
    let (profile, profile_clamp_diagnostics) = resolve_profile(entry, protocol, &overrides)?;
    let base_url = normalize_base_url(overrides.base_url.unwrap_or(entry.default_base_url()));
    Ok(ResolvedEndpoint {
        provider_id,
        model_id: requested_model.to_owned(),
        protocol,
        base_url,
        profile,
        profile_clamp_diagnostics,
    })
}

/// Resolve catalog defaults and attach host-supplied credentials.
pub fn resolve_provider_config(
    provider_id: ProviderId,
    overrides: ProviderOverrides<'_>,
) -> Result<ResolvedProviderConfig> {
    let endpoint = resolve_endpoint(
        provider_id.clone(),
        ResolveOverrides {
            base_url: overrides.base_url,
            model_id: overrides.model,
            protocol: overrides.protocol,
            user_profile: overrides.user_profile,
            host_profile: overrides.host_profile,
        },
    )?;
    Ok(ResolvedProviderConfig {
        provider_id,
        model: endpoint.model_id,
        protocol: endpoint.protocol,
        profile: endpoint.profile,
        base_url: endpoint.base_url,
        api_key: overrides.api_key.unwrap_or_default().to_owned(),
        profile_clamp_diagnostics: endpoint.profile_clamp_diagnostics,
    })
}

/// Apply provider defaults for a host settings projection.
pub fn apply_provider_switch(
    provider_id: ProviderId,
    model_id: &mut String,
    base_url: &mut String,
    clear_api_key: bool,
    api_key: &mut String,
) -> Result<()> {
    let endpoint = resolve_endpoint(
        provider_id,
        ResolveOverrides {
            base_url: None,
            model_id: None,
            protocol: None,
            user_profile: None,
            host_profile: None,
        },
    )?;
    *model_id = endpoint.model_id;
    *base_url = endpoint.base_url;
    if clear_api_key {
        api_key.clear();
    }
    Ok(())
}

fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/').to_owned();
    trimmed
        .strip_suffix("/chat/completions")
        .map(str::to_owned)
        .unwrap_or(trimmed)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    // Scenario: every declared provider exposes catalog invariants for protocol defaults.
    // Expected: default protocol is supported and each supported pair has a profile default.
    // Invariant: provider completeness is expressed without lookup panics.
    #[test]
    fn catalog_covers_declared_providers_and_protocol_profiles() {
        for entry in all_providers() {
            assert!(!entry.api_key_env().is_empty());
            assert!(!entry.models().is_empty());
            assert!(get_model(entry.id(), entry.default_model_id())
                .expect("provider lookup")
                .is_some());
            assert!(entry
                .supported_protocols()
                .contains(&entry.default_protocol()));
            for protocol in entry.supported_protocols() {
                assert!(entry.profile_default_for(*protocol).is_some());
            }
        }
    }

    // Scenario: DeepSeek endpoint resolves without host overrides.
    // Expected: default Responses protocol, v4-flash model, and catalog base URL apply.
    // Invariant: concrete vendor facts remain outside agent-core.
    #[test]
    fn resolve_deepseek_defaults_use_responses_protocol() {
        let endpoint = resolve_endpoint(
            ProviderId::Deepseek,
            ResolveOverrides {
                base_url: None,
                model_id: None,
                protocol: None,
                user_profile: None,
                host_profile: None,
            },
        )
        .expect("resolve");
        assert_eq!(endpoint.model_id, "deepseek-v4-flash");
        assert_eq!(endpoint.protocol, AdapterFamily::OpenAiResponses);
        assert_eq!(endpoint.base_url, "https://api.deepseek.com");
    }

    // Scenario: DeepSeek explicit Chat protocol override is supplied.
    // Expected: Chat profile options apply while model id remains host-selected.
    // Invariant: protocol switch selects that protocol's profile default chain.
    #[test]
    fn resolve_deepseek_chat_protocol_uses_chat_profile() {
        let endpoint = resolve_endpoint(
            ProviderId::Deepseek,
            ResolveOverrides {
                base_url: None,
                model_id: Some("deepseek-chat"),
                protocol: Some(AdapterFamily::OpenAiChatCompletions),
                user_profile: None,
                host_profile: None,
            },
        )
        .expect("resolve");
        assert_eq!(endpoint.model_id, "deepseek-chat");
        assert_eq!(endpoint.protocol, AdapterFamily::OpenAiChatCompletions);
        assert!(matches!(
            endpoint.profile.options,
            AdapterOptions::OpenAiChat(_)
        ));
    }

    // Scenario: Agnes endpoint resolves without host overrides.
    // Expected: Responses default with output_items decode path in wire profile.
    // Invariant: wire compat defaults live on profile, not model rows.
    #[test]
    fn resolve_agnes_defaults_from_catalog_model() {
        let endpoint = resolve_endpoint(
            ProviderId::Agnes,
            ResolveOverrides {
                base_url: None,
                model_id: None,
                protocol: None,
                user_profile: None,
                host_profile: None,
            },
        )
        .expect("resolve");
        assert_eq!(endpoint.model_id, "agnes-2.5-flash");
        assert_eq!(endpoint.base_url, "https://api.agnes-ai.cn/v1");
        assert_eq!(endpoint.protocol, AdapterFamily::OpenAiResponses);
        assert_eq!(
            endpoint.profile.wire.decode.output_text_path.as_deref(),
            Some("output_items")
        );
    }

    // Scenario: an explicit custom model id is supplied for Agnes Chat protocol.
    // Expected: the model id is preserved while Chat profile supplies wire options.
    // Invariant: an explicit host override is never silently rewritten to a catalog default.
    #[test]
    fn custom_model_is_preserved_with_provider_defaults() {
        let endpoint = resolve_endpoint(
            ProviderId::Agnes,
            ResolveOverrides {
                base_url: None,
                model_id: Some("custom-model"),
                protocol: Some(AdapterFamily::OpenAiChatCompletions),
                user_profile: None,
                host_profile: None,
            },
        )
        .expect("resolve");
        assert_eq!(endpoint.model_id, "custom-model");
        assert_eq!(
            endpoint.profile.options,
            AdapterOptions::OpenAiChat(OpenAiChatOptions {
                thinking_extension: OpenAiThinkingExtension::ChatTemplateKwargs,
            })
        );
    }

    // Scenario: ProviderId parsing receives a custom slug.
    // Expected: parsing yields Custom variant for unknown non-empty labels.
    // Invariant: built-in ids remain stable kebab-case strings.
    #[test]
    fn provider_id_parse_accepts_custom_slug() {
        assert_eq!(
            ProviderId::parse("my-proxy").expect("parse"),
            ProviderId::Custom(Cow::Owned("my-proxy".into()))
        );
    }

    // Scenario: settings declares a custom OpenAI Responses proxy provider.
    // Expected: registration exposes catalog lookup and resolves endpoint defaults.
    // Invariant: custom slugs cannot hijack built-in ProviderId values.
    #[test]
    fn register_custom_provider_supports_runtime_catalog_lookup() {
        let defs = BTreeMap::from([(
            "my-proxy".to_owned(),
            CustomProviderDefinition {
                display_name: "My Proxy".into(),
                protocol: AdapterFamily::OpenAiResponses,
                base_url: "https://llm.example.com/v1".into(),
                api_key_env: "MY_PROXY_API_KEY".into(),
                profile_template: "openai-responses".into(),
                profile: None,
                models: vec!["proxy-model".into()],
            },
        )]);
        register_custom_providers(defs).expect("register custom providers");

        let endpoint = resolve_endpoint(
            ProviderId::Custom(Cow::Owned("my-proxy".into())),
            ResolveOverrides {
                base_url: None,
                model_id: None,
                protocol: None,
                user_profile: None,
                host_profile: None,
            },
        )
        .expect("resolve custom provider");
        assert_eq!(endpoint.protocol, AdapterFamily::OpenAiResponses);
        assert_eq!(endpoint.base_url, "https://llm.example.com/v1");
        assert_eq!(endpoint.model_id, "proxy-model");
    }

    // Scenario: a custom provider slug matches a built-in provider id.
    // Expected: registration fails before the catalog can be queried.
    // Invariant: project settings cannot override built-in provider identities.
    #[test]
    fn register_custom_provider_rejects_builtin_slug_conflict() {
        let defs = BTreeMap::from([(
            "deepseek".to_owned(),
            CustomProviderDefinition {
                display_name: "Fake DeepSeek".into(),
                protocol: AdapterFamily::OpenAiResponses,
                base_url: "https://evil.example".into(),
                api_key_env: "EVIL_KEY".into(),
                profile_template: "openai-responses".into(),
                profile: None,
                models: vec![],
            },
        )]);
        assert!(register_custom_providers(defs).is_err());
    }
}
