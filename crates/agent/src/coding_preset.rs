//! Declarative coding preset: static tool rules resolved into names + permission map.

use std::collections::BTreeMap;

use agent_core::r#loop::{ToolPermission, ToolPermissionMap};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodingToolPosture {
    AlwaysAllow,
    AskUnlessAlwaysAllow,
}

struct CodingToolRule {
    name: &'static str,
    posture: CodingToolPosture,
}

const CODING_TOOL_RULES: &[CodingToolRule] = &[
    CodingToolRule {
        name: "read",
        posture: CodingToolPosture::AlwaysAllow,
    },
    CodingToolRule {
        name: "find",
        posture: CodingToolPosture::AlwaysAllow,
    },
    CodingToolRule {
        name: "grep",
        posture: CodingToolPosture::AlwaysAllow,
    },
    CodingToolRule {
        name: "write",
        posture: CodingToolPosture::AskUnlessAlwaysAllow,
    },
    CodingToolRule {
        name: "edit",
        posture: CodingToolPosture::AskUnlessAlwaysAllow,
    },
    CodingToolRule {
        name: "bash",
        posture: CodingToolPosture::AskUnlessAlwaysAllow,
    },
];

/// Builtin catalog tools intentionally omitted from the coding preset.
///
/// Each entry is `(tool_name, reason)`. Preset conformance tests require every
/// catalog tool to appear either here or in [`CODING_TOOL_RULES`].
pub const CODING_PRESET_EXCLUDED: &[(&str, &str)] = &[(
    "web_search",
    "network search is not part of the default coding preset",
)];

/// Host policy for resolving [`resolve_coding_preset`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodingPresetPolicy {
    /// Desktop bootstrap: read/find/grep Allow, write/edit/bash Ask.
    DesktopDefault,
    /// CLI coding defaults: same posture as [`Self::DesktopDefault`].
    Default,
    /// CLI always ask: every preset tool maps to Ask.
    Always,
    /// CLI always allow: every preset tool maps to Allow.
    AlwaysAllow,
}

/// Materialize coding-preset tool names and permission map for the given policy.
pub fn resolve_coding_preset(policy: CodingPresetPolicy) -> (Vec<String>, ToolPermissionMap) {
    let tool_names = CODING_TOOL_RULES
        .iter()
        .map(|rule| rule.name.to_owned())
        .collect::<Vec<_>>();
    let mut permissions = BTreeMap::new();
    for rule in CODING_TOOL_RULES {
        permissions.insert(
            rule.name.to_owned(),
            resolve_permission(rule.posture, policy),
        );
    }
    (tool_names, permissions)
}

fn resolve_permission(posture: CodingToolPosture, policy: CodingPresetPolicy) -> ToolPermission {
    match policy {
        CodingPresetPolicy::AlwaysAllow => ToolPermission::Allow,
        CodingPresetPolicy::Always => ToolPermission::Ask,
        CodingPresetPolicy::Default | CodingPresetPolicy::DesktopDefault => match posture {
            CodingToolPosture::AlwaysAllow => ToolPermission::Allow,
            CodingToolPosture::AskUnlessAlwaysAllow => ToolPermission::Ask,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    use agent_tools::builtin_tool_definitions;

    // Scenario: preset tool names are a subset of the first-party catalog.
    // Expected: every rule name resolves in builtin_tool_definitions; excluded tools are documented.
    // Invariant: catalog additions must update CODING_TOOL_RULES or CODING_PRESET_EXCLUDED.
    #[test]
    fn preset_tools_conform_to_catalog() {
        let catalog_names = builtin_tool_definitions()
            .iter()
            .map(|definition| definition.name())
            .collect::<BTreeSet<_>>();
        let preset_names = CODING_TOOL_RULES
            .iter()
            .map(|rule| rule.name)
            .collect::<BTreeSet<_>>();
        let excluded_names = CODING_PRESET_EXCLUDED
            .iter()
            .map(|(name, _)| *name)
            .collect::<BTreeSet<_>>();

        for name in &preset_names {
            assert!(
                catalog_names.contains(name),
                "preset tool {name} is absent from catalog"
            );
        }

        assert!(
            preset_names.is_disjoint(&excluded_names),
            "preset and excluded tables must not overlap"
        );

        for name in &catalog_names {
            assert!(
                preset_names.contains(name) || excluded_names.contains(name),
                "catalog tool {name} must be in preset rules or CODING_PRESET_EXCLUDED"
            );
        }
    }

    // Scenario: Default / DesktopDefault coding preset is resolved.
    // Expected: read/find/grep Allow; write/edit/bash Ask; six tools total.
    // Invariant: matches historical CLI and Desktop bootstrap behavior.
    #[test]
    fn default_policy_matches_coding_defaults() {
        for policy in [
            CodingPresetPolicy::Default,
            CodingPresetPolicy::DesktopDefault,
        ] {
            let (tool_names, permissions) = resolve_coding_preset(policy);
            assert_eq!(tool_names.len(), 6);
            for name in ["read", "find", "grep"] {
                assert_eq!(permissions.get(name), Some(&ToolPermission::Allow));
            }
            for name in ["write", "edit", "bash"] {
                assert_eq!(permissions.get(name), Some(&ToolPermission::Ask));
            }
        }
    }

    // Scenario: Always approval policy is resolved for the coding preset.
    // Expected: every preset tool maps to Ask.
    // Invariant: policy materialization stays in the composition root, not agent-core loop.
    #[test]
    fn always_policy_maps_all_tools_to_ask() {
        let (_, permissions) = resolve_coding_preset(CodingPresetPolicy::Always);
        assert_eq!(permissions.len(), 6);
        assert!(permissions
            .values()
            .all(|permission| matches!(permission, ToolPermission::Ask)));
    }

    // Scenario: AlwaysAllow approval policy is resolved for the coding preset.
    // Expected: every preset tool maps to Allow.
    // Invariant: always-allow is an explicit host mode, not implicit loop behavior.
    #[test]
    fn always_allow_policy_maps_all_tools_to_allow() {
        let (_, permissions) = resolve_coding_preset(CodingPresetPolicy::AlwaysAllow);
        assert_eq!(permissions.len(), 6);
        assert!(permissions
            .values()
            .all(|permission| matches!(permission, ToolPermission::Allow)));
    }
}
