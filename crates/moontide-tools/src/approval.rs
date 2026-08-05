use std::env;
use std::sync::Mutex;

fn app_env_profile() -> &'static str {
    match env::var("MOONTIDE_ENV")
        .ok()
        .map(|v| v.to_ascii_lowercase())
        .as_deref()
    {
        Some("dev" | "development") => "dev",
        Some("prod" | "production") => "production",
        _ => "production",
    }
}

fn always_allow_from_env() -> bool {
    match env::var("MOONTIDE_ALWAYS_ALLOW")
        .ok()
        .map(|v| v.to_ascii_lowercase())
        .as_deref()
    {
        Some("1" | "true" | "on") => true,
        Some("0" | "false" | "off") => false,
        _ if app_env_profile() == "dev" => true,
        _ => false,
    }
}

/// Runtime toggle for auto-approving ask-class tool permissions.
pub struct AlwaysAllowState {
    override_value: Mutex<Option<bool>>,
    default_enabled: bool,
}

impl AlwaysAllowState {
    pub fn from_env() -> Self {
        Self {
            override_value: Mutex::new(None),
            default_enabled: always_allow_from_env(),
        }
    }

    pub fn is_enabled(&self) -> bool {
        if let Some(value) = *self.override_value.lock().unwrap() {
            return value;
        }
        self.default_enabled
    }

    pub fn set_override(&self, value: Option<bool>) {
        *self.override_value.lock().unwrap() = value;
    }

    pub fn describe(&self) -> String {
        if self.is_enabled() {
            "always allow: on".into()
        } else {
            "always allow: off".into()
        }
    }
}

impl Default for AlwaysAllowState {
    fn default() -> Self {
        Self::from_env()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(default_enabled: bool) -> AlwaysAllowState {
        AlwaysAllowState {
            override_value: Mutex::new(None),
            default_enabled,
        }
    }

    #[test]
    fn override_takes_precedence() {
        let s = state(false);
        s.set_override(Some(true));
        assert!(s.is_enabled());
    }

    #[test]
    fn default_from_constructor() {
        let s = state(true);
        assert!(s.is_enabled());
    }
}
