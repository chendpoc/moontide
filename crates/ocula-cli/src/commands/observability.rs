use std::sync::Arc;

use ocula_observability::{ObservabilityState, ToggleParse, parse_toggle};

pub fn handle_thinking_command(obs: &ObservabilityState, arg: Option<&str>) -> String {
    match parse_toggle(arg) {
        ToggleParse::Invalid => "usage: /thinking on|off|status".into(),
        ToggleParse::Status => {
            let mut lines = vec![obs.describe_modes()];
            lines.push(if obs.is_thinking_enabled() {
                "shows trace call chain: thinking · tool → · result".into()
            } else {
                "thinking off — enable with /thinking on or OCULA_THINKING=1".into()
            });
            lines.join("\n")
        }
        ToggleParse::On => {
            obs.set_thinking_override(Some(true));
            format!("thinking on · {}", obs.describe_modes())
        }
        ToggleParse::Off => {
            obs.set_thinking_override(Some(false));
            format!("thinking off · {}", obs.describe_modes())
        }
    }
}

pub fn handle_verbose_command(obs: &ObservabilityState, arg: Option<&str>) -> String {
    match parse_toggle(arg) {
        ToggleParse::Invalid => "usage: /verbose on|off|status".into(),
        ToggleParse::Status => {
            let mut lines = vec![obs.describe_modes()];
            lines.push(if obs.is_verbose_enabled() {
                "verbose on — context compose summary each turn".into()
            } else {
                "verbose off — enable with /verbose on or OCULA_VERBOSE=1".into()
            });
            lines.join("\n")
        }
        ToggleParse::On => {
            obs.set_verbose_override(Some(true));
            format!("verbose on · {}", obs.describe_modes())
        }
        ToggleParse::Off => {
            obs.set_verbose_override(Some(false));
            format!("verbose off · {}", obs.describe_modes())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thinking_status_does_not_panic() {
        let obs = Arc::new(ObservabilityState::default());
        let out = handle_thinking_command(&obs, Some("status"));
        assert!(out.contains("thinking:"));
    }

    #[test]
    fn verbose_on_implies_thinking_in_status() {
        let obs = Arc::new(ObservabilityState::default());
        let out = handle_verbose_command(&obs, Some("on"));
        assert!(out.contains("verbose on"));
        assert!(obs.is_thinking_enabled());
    }
}
