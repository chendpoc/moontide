//! Protocol capabilities and profile configuration (distinct from wire `protocol` types).

mod capabilities;
mod merge;
mod profile;

pub use capabilities::{
    ProtocolCapabilities,
    ProtocolFeatureConfigPatch,
    ProtocolFeatureConfigSerde,
    ProtocolFeatureSet,
    capabilities_for,
};
pub use merge::{
    ClampDiagnostic,
    ClampReason,
    HostProtocolProfileOverride,
    UserProtocolProfileOverride,
    clamp_features,
    merge_feature_config,
    merge_wire_from_patch,
};
pub use profile::{
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
    default_options_for,
};
