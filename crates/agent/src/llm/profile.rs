//! Protocol profile defaults and layered merge owned by the composition root.

use agent_core::llm::adapter_family::AdapterFamily;
use agent_core::llm::profile_config::{
    AdapterOptions,
    ClampDiagnostic,
    HostProtocolProfileOverride,
    ProtocolFeatureConfig,
    ProtocolFeatureSet,
    ResolvedProtocolProfile,
    UserProtocolProfileOverride,
    WireProfileConfig,
    clamp_features,
    merge_feature_config,
    merge_wire_from_patch,
};

use super::provider_id::ProviderId;

/// Catalog default for one `(provider, protocol)` pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderProtocolProfileDefault {
    pub provider_id: ProviderId,
    pub protocol: AdapterFamily,
    pub features: ProtocolFeatureConfig,
    pub wire: WireProfileConfig,
    pub default_options: AdapterOptions,
    pub vendor_ceiling: ProtocolFeatureSet,
}

/// Merge default ← user ← host, then clamp to capabilities and vendor ceiling.
pub fn merge_protocol_profile(
    default: &ProviderProtocolProfileDefault,
    user: Option<&UserProtocolProfileOverride>,
    host: Option<&HostProtocolProfileOverride>,
) -> (ResolvedProtocolProfile, Vec<ClampDiagnostic>) {
    let mut features = default.features;
    if let Some(user) = user {
        features = merge_feature_config(features, user.features);
    }
    if let Some(host) = host {
        features = merge_feature_config(features, host.features);
    }

    let mut wire = default.wire.clone();
    if let Some(user) = user
        && let Some(patch) = user.wire.clone()
    {
        wire = merge_wire_from_patch(wire, patch);
    }
    if let Some(host) = host
        && let Some(patch) = host.wire.clone()
    {
        wire = merge_wire_from_patch(wire, patch);
    }

    let (features, diagnostics) =
        clamp_features(default.protocol, features.enabled, default.vendor_ceiling);
    for diagnostic in &diagnostics {
        tracing::debug!("protocol profile clamp: {diagnostic}");
    }

    let profile = ResolvedProtocolProfile {
        protocol: default.protocol,
        capabilities: agent_core::llm::profile_config::capabilities_for(default.protocol),
        features,
        wire,
        options: default.default_options.clone(),
    };
    (profile, diagnostics)
}

#[cfg(test)]
mod tests {
    use agent_core::llm::normalize::openai_chat::OpenAiChatOptions;

    use super::*;

    fn deepseek_responses_default() -> ProviderProtocolProfileDefault {
        ProviderProtocolProfileDefault {
            provider_id: ProviderId::Deepseek,
            protocol: AdapterFamily::OpenAiResponses,
            features: ProtocolFeatureConfig::with_enabled(
                ProtocolFeatureSet::STREAMING
                    | ProtocolFeatureSet::TOOLS
                    | ProtocolFeatureSet::THINKING,
            ),
            wire: WireProfileConfig::default(),
            default_options: AdapterOptions::OpenAiResponses(Default::default()),
            vendor_ceiling: ProtocolFeatureSet::STREAMING
                | ProtocolFeatureSet::TOOLS
                | ProtocolFeatureSet::THINKING
                | ProtocolFeatureSet::RESPONSES_PREVIOUS_ID,
        }
    }

    // Scenario: profile merge applies default, then user, then host feature overrides.
    // Expected: host wins over user over catalog default for enabled feature bits.
    // Invariant: merge order is deterministic and typed, not blind assign.
    #[test]
    fn merge_protocol_profile_applies_override_precedence() {
        let default = deepseek_responses_default();
        use agent_core::llm::profile_config::ProtocolFeatureConfigPatch;
        let user = UserProtocolProfileOverride::with_feature_patch(ProtocolFeatureConfigPatch {
            thinking: Some(false),
            ..Default::default()
        });
        let host = HostProtocolProfileOverride {
            protocol: None,
            features: Some(ProtocolFeatureConfigPatch {
                tools: Some(false),
                ..Default::default()
            }),
            wire: None,
        };

        let (profile, _) = merge_protocol_profile(&default, Some(&user), Some(&host));
        assert_eq!(profile.features.enabled, ProtocolFeatureSet::STREAMING);
    }

    // Scenario: DeepSeek user enables Responses store despite vendor ceiling.
    // Expected: store bit is clamped away with a diagnostic, startup continues.
    // Invariant: illegal features never remain enabled after merge.
    #[test]
    fn merge_protocol_profile_clamps_illegal_responses_store() {
        let default = deepseek_responses_default();
        let user = UserProtocolProfileOverride::with_enabled_features(
            default.features.enabled | ProtocolFeatureSet::RESPONSES_STORE,
        );

        let (profile, diagnostics) = merge_protocol_profile(&default, Some(&user), None);
        assert!(
            !profile
                .features
                .enabled
                .contains(ProtocolFeatureSet::RESPONSES_STORE)
        );
        assert!(
            diagnostics
                .iter()
                .any(|entry| entry.feature.contains(ProtocolFeatureSet::RESPONSES_STORE))
        );
    }

    // Scenario: settings JSON only sets one feature flag in the user profile override.
    // Expected: catalog default streaming/tools/thinking remain enabled after merge.
    // Invariant: user profile features are partial patches, not full replacements.
    #[test]
    fn merge_protocol_profile_preserves_default_features_on_partial_user_patch() {
        let default = deepseek_responses_default();
        let user = UserProtocolProfileOverride::with_feature_patch(
            agent_core::llm::profile_config::ProtocolFeatureConfigPatch {
                responses_store: Some(true),
                ..Default::default()
            },
        );

        let (profile, _) = merge_protocol_profile(&default, Some(&user), None);
        assert!(
            profile
                .features
                .enabled
                .contains(ProtocolFeatureSet::STREAMING | ProtocolFeatureSet::TOOLS)
        );
    }

    // Scenario: protocol switch selects a different catalog default chain.
    // Expected: Chat profile options apply without carrying Responses feature toggles.
    // Invariant: profile defaults are scoped per protocol, not merged across protocols.
    #[test]
    fn protocol_switch_uses_matching_profile_default_chain() {
        let responses = deepseek_responses_default();
        let chat = ProviderProtocolProfileDefault {
            provider_id: ProviderId::Deepseek,
            protocol: AdapterFamily::OpenAiChatCompletions,
            features: ProtocolFeatureConfig::with_enabled(
                ProtocolFeatureSet::STREAMING
                    | ProtocolFeatureSet::TOOLS
                    | ProtocolFeatureSet::THINKING,
            ),
            wire: WireProfileConfig::default(),
            default_options: AdapterOptions::OpenAiChat(OpenAiChatOptions::default()),
            vendor_ceiling: ProtocolFeatureSet::STREAMING
                | ProtocolFeatureSet::TOOLS
                | ProtocolFeatureSet::THINKING,
        };

        let responses_user =
            UserProtocolProfileOverride::with_enabled_features(ProtocolFeatureSet::STREAMING);

        let (responses_profile, _) =
            merge_protocol_profile(&responses, Some(&responses_user), None);
        let (chat_profile, _) = merge_protocol_profile(&chat, None, None);

        assert_eq!(responses_profile.protocol, AdapterFamily::OpenAiResponses);
        assert_eq!(chat_profile.protocol, AdapterFamily::OpenAiChatCompletions);
        assert!(matches!(
            chat_profile.options,
            AdapterOptions::OpenAiChat(_)
        ));
        assert!(matches!(
            responses_profile.options,
            AdapterOptions::OpenAiResponses(_)
        ));
        assert_ne!(
            responses_profile.features.enabled,
            chat_profile.features.enabled
        );
    }
}
