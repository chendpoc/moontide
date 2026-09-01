use super::provider;
use super::startup::{EnvSource, ProcessEnv};
use super::ProviderId;

/// Catalog-declared environment variable for a provider's API key.
pub fn api_key_env(provider_id: ProviderId) -> &'static str {
    provider(provider_id).api_key_env()
}

/// Read a non-empty API key from the provider's catalog env var, if set.
pub fn read_api_key_from_env(provider_id: ProviderId) -> Option<String> {
    read_api_key_from_env_source(provider_id, &ProcessEnv)
}

pub(crate) fn read_api_key_from_env_source(
    provider_id: ProviderId,
    env: &impl EnvSource,
) -> Option<String> {
    env.var(api_key_env(provider_id)).and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

/// Require a non-empty API key from the provider's catalog env var.
pub fn require_api_key_from_env(provider_id: ProviderId) -> anyhow::Result<String> {
    read_api_key_from_env(provider_id)
        .ok_or_else(|| anyhow::anyhow!("{} is required", api_key_env(provider_id)))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    struct MapEnv(BTreeMap<&'static str, String>);

    impl EnvSource for MapEnv {
        fn var(&self, name: &str) -> Option<String> {
            self.0.get(name).cloned()
        }
    }

    // Scenario: both provider credentials exist alongside an unrelated invalid provider selector.
    // Expected: the requested provider's key is trimmed and returned independently.
    // Invariant: credential lookup neither parses provider selection nor crosses provider scope.
    #[test]
    fn reads_only_requested_provider_credential() {
        let env = MapEnv(BTreeMap::from([
            ("MOONTIDE_PROVIDER", "invalid".into()),
            ("DEEPSEEK_API_KEY", " deepseek-key ".into()),
            ("AGNES_API_KEY", "agnes-key".into()),
        ]));

        assert_eq!(
            read_api_key_from_env_source(ProviderId::Deepseek, &env).as_deref(),
            Some("deepseek-key")
        );
    }

    // Scenario: the requested provider credential contains only whitespace.
    // Expected: lookup reports the credential as absent.
    // Invariant: blank secrets never enter resolved provider configuration.
    #[test]
    fn rejects_blank_provider_credential() {
        let env = MapEnv(BTreeMap::from([("AGNES_API_KEY", "   ".into())]));
        assert!(read_api_key_from_env_source(ProviderId::Agnes, &env).is_none());
    }
}
