use std::env;
use std::sync::Mutex;

/// Runtime toggle for auto-approving ask-class tool permissions.
pub struct AlwaysAllowState {
    override_value: Mutex<Option<bool>>,
    default_enabled: bool,
}

impl AlwaysAllowState {
    pub fn from_env() -> Self {
        Self {
            override_value: Mutex::new(None),
            default_enabled: env_flag("OCULA_ALWAYS_ALLOW"),
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

fn env_flag(name: &str) -> bool {
    env::var(name)
        .ok()
        .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
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
