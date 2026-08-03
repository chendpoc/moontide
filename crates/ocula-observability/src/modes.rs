use std::env;
use std::sync::Mutex;

/// REPL observability toggles (aligned with TS `src/events/modes.ts`).
pub struct ObservabilityState {
    thinking_override: Mutex<Option<bool>>,
    verbose_override: Mutex<Option<bool>>,
    thinking_default: bool,
    verbose_default: bool,
}

impl ObservabilityState {
    pub fn from_env() -> Self {
        Self {
            thinking_override: Mutex::new(None),
            verbose_override: Mutex::new(None),
            thinking_default: env_flag("OCULA_THINKING"),
            verbose_default: env_flag("OCULA_VERBOSE"),
        }
    }

    pub fn is_verbose_enabled(&self) -> bool {
        if let Some(value) = *self.verbose_override.lock().unwrap() {
            return value;
        }
        self.verbose_default
    }

    pub fn is_thinking_enabled(&self) -> bool {
        if self.is_verbose_enabled() {
            return true;
        }
        if let Some(value) = *self.thinking_override.lock().unwrap() {
            return value;
        }
        self.thinking_default
    }

    pub fn is_observability_enabled(&self) -> bool {
        self.is_thinking_enabled() || self.is_verbose_enabled()
    }

    pub fn set_thinking_override(&self, value: Option<bool>) {
        *self.thinking_override.lock().unwrap() = value;
    }

    pub fn set_verbose_override(&self, value: Option<bool>) {
        *self.verbose_override.lock().unwrap() = value;
    }

    pub fn describe_modes(&self) -> String {
        format!(
            "thinking: {} · verbose: {}",
            if self.is_thinking_enabled() { "on" } else { "off" },
            if self.is_verbose_enabled() { "on" } else { "off" }
        )
    }

    pub fn reset_overrides(&self) {
        *self.thinking_override.lock().unwrap() = None;
        *self.verbose_override.lock().unwrap() = None;
    }
}

impl Default for ObservabilityState {
    fn default() -> Self {
        Self::from_env()
    }
}

fn env_flag(name: &str) -> bool {
    env::var(name).ok().is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleParse {
    On,
    Off,
    Status,
    Invalid,
}

pub fn parse_toggle(arg: Option<&str>) -> ToggleParse {
    match arg.map(str::trim).filter(|s| !s.is_empty()) {
        None | Some("status") => ToggleParse::Status,
        Some("on") | Some("1") | Some("true") => ToggleParse::On,
        Some("off") | Some("0") | Some("false") => ToggleParse::Off,
        Some(_) => ToggleParse::Invalid,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with_defaults(thinking: bool, verbose: bool) -> ObservabilityState {
        ObservabilityState {
            thinking_override: Mutex::new(None),
            verbose_override: Mutex::new(None),
            thinking_default: thinking,
            verbose_default: verbose,
        }
    }

    #[test]
    fn verbose_implies_thinking() {
        let obs = state_with_defaults(false, true);
        assert!(obs.is_verbose_enabled());
        assert!(obs.is_thinking_enabled());
    }

    #[test]
    fn override_takes_precedence() {
        let obs = state_with_defaults(false, false);
        obs.set_thinking_override(Some(true));
        assert!(obs.is_thinking_enabled());
    }

    #[test]
    fn parse_toggle_values() {
        assert_eq!(parse_toggle(Some("on")), ToggleParse::On);
        assert_eq!(parse_toggle(Some("status")), ToggleParse::Status);
        assert_eq!(parse_toggle(Some("maybe")), ToggleParse::Invalid);
    }
}
