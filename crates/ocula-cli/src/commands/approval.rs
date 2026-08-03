use std::sync::Arc;

use ocula_observability::{parse_toggle, ToggleParse};
use ocula_tools::AlwaysAllowState;

pub fn handle_always_allow_command(state: &AlwaysAllowState, arg: Option<&str>) -> String {
    match parse_toggle(arg) {
        ToggleParse::Invalid => "usage: /always-allow on|off|status".into(),
        ToggleParse::Status => {
            let mut lines = vec![state.describe()];
            lines.push(if state.is_enabled() {
                "ask-class tools run without confirmation".into()
            } else {
                "prompts Allow tool? [y/N] for ask-class tools".into()
            });
            lines.join("\n")
        }
        ToggleParse::On => {
            state.set_override(Some(true));
            format!("{} · ask-class tools auto-approved", state.describe())
        }
        ToggleParse::Off => {
            state.set_override(Some(false));
            format!("{} · ask-class tools require confirmation", state.describe())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_does_not_panic() {
        let state = Arc::new(AlwaysAllowState::default());
        let out = handle_always_allow_command(&state, Some("status"));
        assert!(out.contains("always allow:"));
    }

    #[test]
    fn on_enables_auto_approve() {
        let state = Arc::new(AlwaysAllowState::default());
        let out = handle_always_allow_command(&state, Some("on"));
        assert!(out.contains("on"));
        assert!(state.is_enabled());
    }
}
