use std::env;

use ocula_protocol::ToolResultSummary;

/// Tool output projection / persistence configuration (env-backed).
#[derive(Debug, Clone)]
pub struct ToolProjectionConfig {
    pub inline_max: usize,
    pub artifact_min: usize,
    pub preview_chars: usize,
    pub inline_floor: usize,
    pub context_limit: usize,
    pub keep_turns: u32,
}

impl Default for ToolProjectionConfig {
    fn default() -> Self {
        Self::from_env()
    }
}

impl ToolProjectionConfig {
    pub fn from_env() -> Self {
        Self {
            inline_max: env_usize("OCULA_TOOL_INLINE_MAX", 8192),
            artifact_min: env_usize("OCULA_TOOL_ARTIFACT_MIN", 8192),
            preview_chars: env_usize("OCULA_TOOL_PREVIEW_CHARS", 500),
            inline_floor: env_usize("OCULA_TOOL_INLINE_FLOOR", 500),
            context_limit: env_usize("OCULA_CONTEXT_LIMIT", 128_000),
            keep_turns: env_u32("OCULA_COMPACT_KEEP_TURNS", 3),
        }
    }

    /// Dynamic inline char budget from estimated context usage.
    pub fn dynamic_inline_budget(&self, estimated_chars: usize) -> usize {
        let remaining = self.context_limit.saturating_sub(estimated_chars);
        let scaled = (remaining as f64 * 0.15) as usize;
        scaled.clamp(self.inline_floor, self.inline_max)
    }
}

#[derive(Debug, Clone)]
pub struct PreparedToolOutcome {
    pub result_summary: ToolResultSummary,
    pub store_artifact: bool,
}

/// Decide log summary + whether full content should go to Artifact Store.
pub fn prepare_tool_outcome(content: &str, config: &ToolProjectionConfig) -> PreparedToolOutcome {
    let byte_count = content.len() as u32;
    let line_count = if content.is_empty() {
        0
    } else {
        content.lines().count() as u32
    };

    let store_artifact = content.len() >= config.artifact_min;
    let (summary, truncated) = if store_artifact {
        (preview_chars(content, config.preview_chars), true)
    } else {
        (content.to_string(), false)
    };

    PreparedToolOutcome {
        result_summary: ToolResultSummary {
            summary,
            byte_count,
            line_count: Some(line_count),
            truncated: if truncated { Some(true) } else { None },
        },
        store_artifact,
    }
}

pub fn preview_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    format!(
        "{}…",
        text.chars().take(limit).collect::<String>()
    )
}

pub fn truncation_footnote(summary: &ToolResultSummary, artifact_id: Option<&str>) -> String {
    truncation_footnote_for_tool("unknown", summary, artifact_id)
}

pub fn truncation_footnote_for_tool(
    tool_name: &str,
    summary: &ToolResultSummary,
    artifact_id: Option<&str>,
) -> String {
    crate::truncation_strategies::format_truncation_with_strategies(tool_name, summary, artifact_id)
}

pub fn estimate_messages_chars(messages: &[ocula_protocol::Message]) -> usize {
    use ocula_protocol::{ContentBlock, MessageContent};
    messages
        .iter()
        .map(|m| match &m.content {
            MessageContent::Text(t) => t.len(),
            MessageContent::Blocks(blocks) => blocks
                .iter()
                .map(|b| match b {
                    ContentBlock::Text { text } => text.len(),
                    ContentBlock::Thinking { thinking } => thinking.len(),
                    ContentBlock::ToolUse { name, input, .. } => {
                        name.len() + input.to_string().len()
                    }
                    ContentBlock::ToolResult { content, .. } => match content {
                        ocula_protocol::ToolResultContent::Text(t) => t.len(),
                        ocula_protocol::ToolResultContent::Blocks(blocks) => blocks
                            .iter()
                            .map(|b| match b {
                                ContentBlock::Text { text } => text.len(),
                                _ => 0,
                            })
                            .sum(),
                    },
                })
                .sum(),
        })
        .sum()
}

fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_u32(name: &str, default: u32) -> u32 {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_output_not_stored_as_artifact() {
        let cfg = ToolProjectionConfig {
            inline_max: 8192,
            artifact_min: 8192,
            preview_chars: 500,
            inline_floor: 500,
            context_limit: 128_000,
            keep_turns: 3,
        };
        let prep = prepare_tool_outcome("hello", &cfg);
        assert!(!prep.store_artifact);
        assert_eq!(prep.result_summary.summary, "hello");
        assert!(prep.result_summary.truncated.is_none());
    }

    #[test]
    fn large_output_preview_and_artifact_flag() {
        let cfg = ToolProjectionConfig {
            artifact_min: 100,
            preview_chars: 20,
            ..ToolProjectionConfig::from_env()
        };
        let content = "x".repeat(200);
        let prep = prepare_tool_outcome(&content, &cfg);
        assert!(prep.store_artifact);
        assert_eq!(prep.result_summary.truncated, Some(true));
        assert!(prep.result_summary.summary.len() <= 25);
    }
}
