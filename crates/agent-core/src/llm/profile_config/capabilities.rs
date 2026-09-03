use bitflags::bitflags;
use serde::{
    Deserialize,
    Serialize,
};

use crate::llm::adapter_family::AdapterFamily;

bitflags! {
    /// Implemented feature ceiling for one wire family (static; not user-mergeable).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct ProtocolFeatureSet: u64 {
        const STREAMING            = 1 << 0;
        const TOOLS                = 1 << 1;
        const THINKING             = 1 << 2;
        const VISION               = 1 << 3;
        const RESPONSES_STORE              = 1 << 8;
        const RESPONSES_PREVIOUS_ID        = 1 << 9;
        const RESPONSES_CONVERSATION       = 1 << 10;
        const RESPONSES_WEBSOCKET          = 1 << 11;
        const ANTHROPIC_PROMPT_CACHE       = 1 << 16;
    }
}

impl ProtocolFeatureSet {
    /// Intersection used by profile merge clamp.
    pub fn clamp_to(self, ceiling: Self) -> Self {
        self.intersection(ceiling)
    }
}

/// Static capability declaration for one adapter family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolCapabilities {
    pub family: AdapterFamily,
    pub features: ProtocolFeatureSet,
}

/// Returns the static capability ceiling for `family`.
pub fn capabilities_for(family: AdapterFamily) -> ProtocolCapabilities {
    use AdapterFamily::*;
    use ProtocolFeatureSet as F;
    let features = match family {
        OpenAiChatCompletions => F::STREAMING | F::TOOLS | F::THINKING | F::VISION,
        OpenAiResponses => {
            F::STREAMING
                | F::TOOLS
                | F::THINKING
                | F::VISION
                | F::RESPONSES_STORE
                | F::RESPONSES_PREVIOUS_ID
                | F::RESPONSES_CONVERSATION
                | F::RESPONSES_WEBSOCKET
        }
        AnthropicMessages => {
            F::STREAMING | F::TOOLS | F::THINKING | F::VISION | F::ANTHROPIC_PROMPT_CACHE
        }
        GoogleGenerativeAi => F::STREAMING | F::TOOLS | F::THINKING | F::VISION,
    };
    ProtocolCapabilities { family, features }
}

/// Partial feature override for settings JSON (unset fields leave the base unchanged).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProtocolFeatureConfigPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses_store: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses_previous_id: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses_conversation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responses_websocket: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_prompt_cache: Option<bool>,
}

impl ProtocolFeatureConfigPatch {
    pub fn is_empty(self) -> bool {
        self.streaming.is_none()
            && self.tools.is_none()
            && self.thinking.is_none()
            && self.vision.is_none()
            && self.responses_store.is_none()
            && self.responses_previous_id.is_none()
            && self.responses_conversation.is_none()
            && self.responses_websocket.is_none()
            && self.anthropic_prompt_cache.is_none()
    }

    /// Apply only set fields onto `base`.
    pub fn apply_to(self, base: ProtocolFeatureSet) -> ProtocolFeatureSet {
        use ProtocolFeatureSet as F;
        let mut enabled = base;
        apply_flag(&mut enabled, F::STREAMING, self.streaming);
        apply_flag(&mut enabled, F::TOOLS, self.tools);
        apply_flag(&mut enabled, F::THINKING, self.thinking);
        apply_flag(&mut enabled, F::VISION, self.vision);
        apply_flag(&mut enabled, F::RESPONSES_STORE, self.responses_store);
        apply_flag(
            &mut enabled,
            F::RESPONSES_PREVIOUS_ID,
            self.responses_previous_id,
        );
        apply_flag(
            &mut enabled,
            F::RESPONSES_CONVERSATION,
            self.responses_conversation,
        );
        apply_flag(
            &mut enabled,
            F::RESPONSES_WEBSOCKET,
            self.responses_websocket,
        );
        apply_flag(
            &mut enabled,
            F::ANTHROPIC_PROMPT_CACHE,
            self.anthropic_prompt_cache,
        );
        enabled
    }

    /// Explicit patch for every known feature bit (used in tests and full exports).
    pub fn from_feature_set(set: ProtocolFeatureSet) -> Self {
        use ProtocolFeatureSet as F;
        Self {
            streaming: Some(set.contains(F::STREAMING)),
            tools: Some(set.contains(F::TOOLS)),
            thinking: Some(set.contains(F::THINKING)),
            vision: Some(set.contains(F::VISION)),
            responses_store: Some(set.contains(F::RESPONSES_STORE)),
            responses_previous_id: Some(set.contains(F::RESPONSES_PREVIOUS_ID)),
            responses_conversation: Some(set.contains(F::RESPONSES_CONVERSATION)),
            responses_websocket: Some(set.contains(F::RESPONSES_WEBSOCKET)),
            anthropic_prompt_cache: Some(set.contains(F::ANTHROPIC_PROMPT_CACHE)),
        }
    }
}

fn apply_flag(enabled: &mut ProtocolFeatureSet, bit: ProtocolFeatureSet, value: Option<bool>) {
    match value {
        Some(true) => *enabled |= bit,
        Some(false) => *enabled -= bit,
        None => {}
    }
}

impl From<ProtocolFeatureSet> for ProtocolFeatureConfigPatch {
    fn from(set: ProtocolFeatureSet) -> Self {
        Self::from_feature_set(set)
    }
}

/// Back-compat alias for settings serde field naming in docs.
pub type ProtocolFeatureConfigSerde = ProtocolFeatureConfigPatch;

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: each declared adapter family exposes a non-empty capability set.
    // Expected: capabilities_for returns features matching the family.
    // Invariant: capability lookup is total over AdapterFamily.
    #[test]
    fn capabilities_cover_all_families() {
        for family in [
            AdapterFamily::OpenAiChatCompletions,
            AdapterFamily::OpenAiResponses,
            AdapterFamily::AnthropicMessages,
            AdapterFamily::GoogleGenerativeAi,
        ] {
            let caps = capabilities_for(family);
            assert_eq!(caps.family, family);
            assert!(caps.features.contains(ProtocolFeatureSet::STREAMING));
        }
    }

    // Scenario: Responses family declares continuity features Chat lacks.
    // Expected: RESPONSES_PREVIOUS_ID is present only on Responses.
    // Invariant: protocol-specific bits are family-scoped.
    #[test]
    fn responses_capabilities_include_previous_id() {
        let responses = capabilities_for(AdapterFamily::OpenAiResponses);
        let chat = capabilities_for(AdapterFamily::OpenAiChatCompletions);
        assert!(responses
            .features
            .contains(ProtocolFeatureSet::RESPONSES_PREVIOUS_ID));
        assert!(!chat
            .features
            .contains(ProtocolFeatureSet::RESPONSES_PREVIOUS_ID));
    }

    // Scenario: settings JSON only toggles one feature flag.
    // Expected: other enabled bits from the catalog default remain intact.
    // Invariant: feature merge is a partial patch, not a full replacement.
    #[test]
    fn feature_patch_preserves_unmentioned_bits() {
        use ProtocolFeatureSet as F;
        let base = F::STREAMING | F::TOOLS | F::THINKING;
        let patch = ProtocolFeatureConfigPatch {
            responses_store: Some(true),
            ..Default::default()
        };
        let merged = patch.apply_to(base);
        assert!(merged.contains(F::STREAMING | F::TOOLS | F::THINKING | F::RESPONSES_STORE));
    }
}
