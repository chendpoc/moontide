use super::provider_id::ProviderId;
use super::{
    provider,
    EnvSource,
    ProcessEnv,
};

/// Catalog-declared environment variable for a provider's API key.
pub fn api_key_env(provider_id: ProviderId) -> anyhow::Result<&'static str> {
    Ok(provider(provider_id)?.api_key_env())
}

/// Read a non-empty API key from the provider's catalog env var, if set.
pub fn read_api_key_from_env(provider_id: ProviderId) -> anyhow::Result<Option<String>> {
    read_api_key_from_env_source(provider_id, &ProcessEnv)
}

pub(crate) fn read_api_key_from_env_source(
    provider_id: ProviderId,
    env: &impl EnvSource,
) -> anyhow::Result<Option<String>> {
    Ok(env
        .var(api_key_env(provider_id.clone())?)
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        }))
}

/// Require a non-empty API key from the provider's catalog env var.
pub fn require_api_key_from_env(provider_id: ProviderId) -> anyhow::Result<String> {
    let env_name = api_key_env(provider_id.clone())?;
    read_api_key_from_env(provider_id)?.ok_or_else(|| anyhow::anyhow!("{env_name} is required"))
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
    fn reads_only_requested_provider_credential() -> anyhow::Result<()> {
        let env = MapEnv(BTreeMap::from([
            ("MOONTIDE_PROVIDER", "invalid".into()),
            ("DEEPSEEK_API_KEY", " deepseek-key ".into()),
            ("AGNES_API_KEY", "agnes-key".into()),
        ]));

        assert_eq!(
            read_api_key_from_env_source(ProviderId::Deepseek, &env)?.as_deref(),
            Some("deepseek-key")
        );
        Ok(())
    }

    // Scenario: the requested provider credential contains only whitespace.
    // Expected: lookup reports the credential as absent.
    // Invariant: blank secrets never enter resolved provider configuration.
    #[test]
    fn rejects_blank_provider_credential() -> anyhow::Result<()> {
        let env = MapEnv(BTreeMap::from([("AGNES_API_KEY", "   ".into())]));
        assert!(read_api_key_from_env_source(ProviderId::Agnes, &env)?.is_none());
        Ok(())
    }
}
