use ocula_protocol::{Message, SessionLog, ToolSchema};
use ocula_tools::{tool_definitions, ToolProjectionConfig};

use crate::compaction::prune::{estimate_percent_used, prune_messages};
use crate::fallback::{
    apply_truncation_fallback, build_truncation_bundle_message, collect_truncated_in_window,
    remaining_budget_after_messages,
};
use crate::log_to_messages::{log_to_messages, ProjectionContext, ArtifactLoader};

#[derive(Clone)]
pub struct ComposeOptions {
    pub config: ToolProjectionConfig,
    pub artifact_loader: Option<ArtifactLoader>,
    pub auto_compact: bool,
    pub compact_threshold: u32,
}

impl Default for ComposeOptions {
    fn default() -> Self {
        Self::from_env()
    }
}

impl ComposeOptions {
    pub fn from_env() -> Self {
        let auto_compact = std::env::var("OCULA_COMPACT_AUTO")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        let compact_threshold = std::env::var("OCULA_COMPACT_THRESHOLD")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(85);
        Self {
            config: ToolProjectionConfig::from_env(),
            artifact_loader: None,
            auto_compact,
            compact_threshold,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ComposedLlmRequest {
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolSchema>,
    pub truncated_count: u32,
    pub artifact_count: u32,
}

pub fn compose_context_v1(system: String, messages: Vec<Message>) -> ComposedLlmRequest {
    let mut tools = tool_definitions();
    tools.sort_by(|a, b| a.name.cmp(&b.name));
    ComposedLlmRequest {
        system,
        messages,
        tools,
        truncated_count: 0,
        artifact_count: 0,
    }
}

pub fn compose_context(
    system: String,
    log: &[SessionLog],
    up_to_turn: Option<u32>,
    options: &ComposeOptions,
) -> ComposedLlmRequest {
    let keep_from_turn = ProjectionContext::recent_window_turn(log, options.config.keep_turns);
    let base_messages = log_to_messages(log, up_to_turn, None);
    let inline_budget = remaining_budget_after_messages(
        &options.config,
        &base_messages,
        system.len(),
    );

    let proj_ctx = ProjectionContext {
        config: options.config.clone(),
        artifact_loader: options.artifact_loader.clone(),
        inline_budget,
        keep_from_turn,
    };

    let mut messages = log_to_messages(log, up_to_turn, Some(&proj_ctx));

    let artifact_count = log
        .iter()
        .filter(|r| {
            matches!(
                r,
                SessionLog::ToolOutcome {
                    artifact_id: Some(_),
                    ..
                }
            )
        })
        .count() as u32;

    let truncated_in_window = collect_truncated_in_window(log, keep_from_turn);
    let truncated_count = truncated_in_window.len() as u32;

    if truncated_in_window.len() >= 2 {
        if let Some(loader) = &options.artifact_loader {
            let loader_fn = |id: &str| loader(id);
            let remaining = options
                .config
                .context_limit
                .saturating_sub(estimate_messages_chars(&messages) + system.len());
            let (expanded, changed) = apply_truncation_fallback(
                messages,
                &truncated_in_window,
                &loader_fn,
                remaining,
            );
            messages = expanded;
            if !changed {
                if let Some(bundle) = build_truncation_bundle_message(&truncated_in_window, &loader_fn)
                {
                    messages.push(bundle);
                }
            }
        }
    }

    let mut compact_truncated = 0u32;
    if options.auto_compact {
        let pct = estimate_percent_used(&messages, &system, options.config.context_limit);
        if pct >= options.compact_threshold {
            let (pruned, n) = prune_messages(messages, options.config.keep_turns);
            messages = pruned;
            compact_truncated = n;
        }
    }

    let mut tools = tool_definitions();
    tools.sort_by(|a, b| a.name.cmp(&b.name));

    ComposedLlmRequest {
        system,
        messages,
        tools,
        truncated_count: truncated_count + compact_truncated,
        artifact_count,
    }
}

fn estimate_messages_chars(messages: &[Message]) -> usize {
    ocula_tools::estimate_messages_chars(messages)
}
