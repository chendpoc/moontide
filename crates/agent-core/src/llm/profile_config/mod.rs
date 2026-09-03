//! Protocol capabilities and profile configuration (distinct from wire `protocol` types).

mod capabilities;
mod merge;
mod profile;

pub use capabilities::{
    capabilities_for,
    ProtocolCapabilities,
    ProtocolFeatureConfigPatch,
    ProtocolFeatureConfigSerde,
    ProtocolFeatureSet,
};
pub use merge::{
    clamp_features,
    merge_feature_config,
    merge_wire_from_patch,
    ClampDiagnostic,
    ClampReason,
    HostProtocolProfileOverride,
    UserProtocolProfileOverride,
};
pub use profile::{
    default_options_for,
    AdapterOptions,
    AnthropicMessagesOptions,
    ContinuityHint,
    GoogleGenerativeAiOptions,
    OpenAiResponsesOptions,
    ProtocolFeatureConfig,
    ResolvedProtocolProfile,
    WireDecodeConfig,
    WireEncodeConfig,
    WireHttpConfig,
    WireProfileConfig,
    WireProfilePatch,
};
