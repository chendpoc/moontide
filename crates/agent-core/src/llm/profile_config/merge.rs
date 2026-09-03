use std::fmt;

use serde::{
    Deserialize,
    Serialize,
};

use super::capabilities::{
    ProtocolFeatureConfigPatch,
    ProtocolFeatureSet,
    capabilities_for,
};
use super::profile::{
    ProtocolFeatureConfig,
    WireProfileConfig,
    WireProfilePatch,
};
use crate::llm::adapter_family::AdapterFamily;

/// Optional protocol/profile patch from settings or custom provider declarations.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct UserProtocolProfileOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<AdapterFamily>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<ProtocolFeatureConfigPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wire: Option<WireProfilePatch>,
}

impl UserProtocolProfileOverride {
    pub fn with_feature_patch(patch: ProtocolFeatureConfigPatch) -> Self {
        Self {
            features: Some(patch),
            ..Default::default()
        }
    }

    pub fn with_enabled_features(enabled: ProtocolFeatureSet) -> Self {
        Self::with_feature_patch(ProtocolFeatureConfigPatch::from_feature_set(enabled))
    }
}

/// CLI/env protocol/profile patch layered above persisted settings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostProtocolProfileOverride {
    pub protocol: Option<AdapterFamily>,
    pub features: Option<ProtocolFeatureConfigPatch>,
    pub wire: Option<WireProfilePatch>,
}

/// Records one feature bit removed by clamp with a short diagnostic reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClampDiagnostic {
    pub feature: ProtocolFeatureSet,
    pub reason: ClampReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClampReason {
    ExceedsProtocolCapabilities,
    ExceedsVendorCeiling,
}

impl fmt::Display for ClampDiagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let feature = format!("{:?}", self.feature);
        let reason = match self.reason {
            ClampReason::ExceedsProtocolCapabilities => "exceeds protocol capabilities",
            ClampReason::ExceedsVendorCeiling => "exceeds vendor ceiling",
        };
        write!(f, "removed feature {feature}: {reason}")
    }
}

pub fn merge_feature_config(
    base: ProtocolFeatureConfig,
    patch: Option<ProtocolFeatureConfigPatch>,
) -> ProtocolFeatureConfig {
    match patch {
        Some(patch) if !patch.is_empty() => ProtocolFeatureConfig {
            enabled: patch.apply_to(base.enabled),
        },
        _ => base,
    }
}

/// Clamp enabled features to protocol capabilities and vendor ceiling; emit diagnostics.
pub fn clamp_features(
    protocol: AdapterFamily,
    enabled: ProtocolFeatureSet,
    vendor_ceiling: ProtocolFeatureSet,
) -> (ProtocolFeatureConfig, Vec<ClampDiagnostic>) {
    let capabilities = capabilities_for(protocol);
    let allowed = capabilities.features & vendor_ceiling;
    let clamped = enabled & allowed;
    let removed = enabled - clamped;
    let mut diagnostics = Vec::new();

    for feature in removed.iter() {
        let reason = if !capabilities.features.contains(feature) {
            ClampReason::ExceedsProtocolCapabilities
        } else {
            ClampReason::ExceedsVendorCeiling
        };
        diagnostics.push(ClampDiagnostic { feature, reason });
    }

    (ProtocolFeatureConfig { enabled: clamped }, diagnostics)
}

pub fn merge_wire_from_patch(
    base: WireProfileConfig,
    patch: WireProfilePatch,
) -> WireProfileConfig {
    let mut wire = base;
    patch.merge_into(&mut wire);
    wire
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::profile_config::ProtocolFeatureConfig;

    // Scenario: layered feature patches merge like Object.assign on individual flags.
    // Expected: host overrides only the fields it sets; earlier layers keep other bits.
    // Invariant: merge order is default ← user ← host with partial patches.
    #[test]
    fn merge_feature_config_applies_partial_patches_in_order() {
        use ProtocolFeatureSet as F;
        let base = ProtocolFeatureConfig::with_enabled(F::STREAMING | F::TOOLS | F::THINKING);
        let after_user = merge_feature_config(
            base,
            Some(ProtocolFeatureConfigPatch {
                thinking: Some(false),
                ..Default::default()
            }),
        );
        let after_host = merge_feature_config(
            after_user,
            Some(ProtocolFeatureConfigPatch {
                tools: Some(false),
                ..Default::default()
            }),
        );
        assert_eq!(after_host.enabled, F::STREAMING);
    }
}
