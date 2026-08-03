use std::sync::Arc;

use crate::theme;
use crate::ObservabilityState;

const RESULT_PREVIEW_CHARS: usize = 80;

#[derive(Clone)]
pub struct TraceWriter {
    obs: Arc<ObservabilityState>,
}

impl TraceWriter {
    pub fn new(obs: Arc<ObservabilityState>) -> Self {
        Self { obs }
    }

    pub fn compose_summary(
        &self,
        message_count: usize,
        tool_count: usize,
        system_chars: usize,
        truncated_count: u32,
        artifact_count: u32,
    ) {
        if !self.obs.is_verbose_enabled() {
            return;
        }
        eprintln!(
            "{}",
            theme::compose_summary_line(
                message_count,
                tool_count,
                system_chars,
                truncated_count,
                artifact_count,
            )
        );
    }

    pub fn turn_start(&self, turn: u32) {
        if !self.obs.is_thinking_enabled() {
            return;
        }
        eprintln!("{}", theme::turn_banner(turn));
    }

    pub fn thinking(&self, _turn: u32, body: &str) {
        if !self.obs.is_thinking_enabled() {
            return;
        }
        eprintln!("{}", theme::thinking_line(&truncate_one_line(body)));
    }

    pub fn tool_use(&self, _turn: u32, name: &str, preview: &str) {
        if !self.obs.is_thinking_enabled() {
            return;
        }
        eprintln!(
            "{}",
            theme::tool_use_line(name, &truncate_one_line(preview))
        );
    }

    pub fn tool_result(
        &self,
        _turn: u32,
        content: &str,
        artifact_id: Option<&str>,
        truncated: bool,
    ) {
        if !self.obs.is_thinking_enabled() {
            return;
        }
        eprintln!(
            "{}",
            theme::tool_result_line(
                content.len(),
                &truncate_one_line(content),
                artifact_id,
                truncated,
            )
        );
    }
}

fn truncate_one_line(text: &str) -> String {
    let one_line = text.replace('\n', " ").trim().to_string();
    if one_line.chars().count() <= RESULT_PREVIEW_CHARS {
        one_line
    } else {
        format!(
            "{}…",
            one_line.chars().take(RESULT_PREVIEW_CHARS).collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_long_line() {
        let s = "a".repeat(100);
        assert!(truncate_one_line(&s).ends_with('…'));
    }
}
