use serde::{
    Deserialize,
    Serialize,
};

use super::capabilities::{
    ProtocolCapabilities,
    ProtocolFeatureSet,
    capabilities_for,
};
use crate::llm::adapter_family::AdapterFamily;
use crate::llm::normalize::openai_chat::OpenAiChatOptions;

/// User-toggleable feature subset (mergeable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolFeatureConfig {
    pub enabled: ProtocolFeatureSet,
}

impl Default for ProtocolFeatureConfig {
    fn default() -> Self {
        Self {
            enabled: ProtocolFeatureSet::empty(),
        }
    }
}

impl ProtocolFeatureConfig {
    pub fn with_enabled(enabled: ProtocolFeatureSet) -> Self {
        Self { enabled }
    }
}

/// How adapter encodes outbound wire payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct WireEncodeConfig {}

/// How adapter decodes inbound wire payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct WireDecodeConfig {
    /// JSON path hint for aggregated text (e.g. Agnes `output_items`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_text_path: Option<String>,
    /// DeepSeek reasoning delta field name override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_delta_field: Option<String>,
}

/// Transport-level wire options.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct WireHttpConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefer_websocket: Option<bool>,
}

/// Full wire profile attached to a resolved protocol profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct WireProfileConfig {
    pub encode: WireEncodeConfig,
    pub decode: WireDecodeConfig,
    pub http: WireHttpConfig,
}

/// Partial wire override from settings (merge into default).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WireProfilePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encode: Option<WireEncodeConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decode: Option<WireDecodeConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http: Option<WireHttpConfig>,
}

impl WireProfilePatch {
    pub fn merge_into(self, base: &mut WireProfileConfig) {
        if let Some(decode) = self.decode {
            if let Some(path) = decode.output_text_path {
                base.decode.output_text_path = Some(path);
            }
            if let Some(field) = decode.reasoning_delta_field {
                base.decode.reasoning_delta_field = Some(field);
            }
        }
        if let Some(http) = self.http
            && let Some(prefer) = http.prefer_websocket
        {
            base.http.prefer_websocket = Some(prefer);
        }
        let _ = self.encode;
    }
}

/// Per-family adapter options carried on resolved profile (not in ModelRequest).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterOptions {
    OpenAiChat(OpenAiChatOptions),
    OpenAiResponses(OpenAiResponsesOptions),
    AnthropicMessages(AnthropicMessagesOptions),
    GoogleGenerativeAi(GoogleGenerativeAiOptions),
}

impl Default for AdapterOptions {
    fn default() -> Self {
        Self::OpenAiChat(OpenAiChatOptions::default())
    }
}

/// OpenAI Responses adapter options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OpenAiResponsesOptions {}

/// Anthropic Messages adapter options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AnthropicMessagesOptions {
    pub prompt_cache: bool,
}

/// Google Generative AI adapter options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GoogleGenerativeAiOptions {}

/// Merge output consumed by L2/L3 runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProtocolProfile {
    pub protocol: AdapterFamily,
    pub capabilities: ProtocolCapabilities,
    pub features: ProtocolFeatureConfig,
    pub wire: WireProfileConfig,
    pub options: AdapterOptions,
}

impl ResolvedProtocolProfile {
    pub fn for_protocol(protocol: AdapterFamily, features: ProtocolFeatureSet) -> Self {
        Self {
            protocol,
            capabilities: capabilities_for(protocol),
            features: ProtocolFeatureConfig::with_enabled(features),
            wire: WireProfileConfig::default(),
            options: default_options_for(protocol),
        }
    }
}

pub fn default_options_for(protocol: AdapterFamily) -> AdapterOptions {
    match protocol {
        AdapterFamily::OpenAiChatCompletions => {
            AdapterOptions::OpenAiChat(OpenAiChatOptions::default())
        }
        AdapterFamily::OpenAiResponses => {
            AdapterOptions::OpenAiResponses(OpenAiResponsesOptions::default())
        }
        AdapterFamily::AnthropicMessages => {
            AdapterOptions::AnthropicMessages(AnthropicMessagesOptions::default())
        }
        AdapterFamily::GoogleGenerativeAi => {
            AdapterOptions::GoogleGenerativeAi(GoogleGenerativeAiOptions::default())
        }
    }
}

/// Optimized-path continuity hint (turn-local; not Session Item).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContinuityHint {
    pub previous_response_id: Option<String>,
}
