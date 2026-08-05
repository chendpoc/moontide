use std::collections::HashMap;
use std::sync::Arc;

use moontide_protocol::{ContentBlock, Message, MessageContent, Role, SessionLog, ToolResultSummary};
use moontide_tools::{
    preview_chars, truncation_footnote_for_tool, ToolProjectionConfig,
};

pub type ArtifactLoader = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

#[derive(Clone)]
pub struct ProjectionContext {
    pub config: ToolProjectionConfig,
    pub artifact_loader: Option<ArtifactLoader>,
    pub inline_budget: usize,
    pub keep_from_turn: u32,
}

impl ProjectionContext {
    pub fn recent_window_turn(log: &[SessionLog], keep_turns: u32) -> u32 {
        let mut user_turns = 0u32;
        let mut keep_from = 0u32;
        for record in log.iter().rev() {
            if matches!(record, SessionLog::UserMessage { .. }) {
                user_turns += 1;
                keep_from = record.turn();
                if user_turns >= keep_turns {
                    break;
                }
            }
        }
        keep_from
    }
}

pub fn log_to_messages(
    log: &[SessionLog],
    up_to_turn: Option<u32>,
    ctx: Option<&ProjectionContext>,
) -> Vec<Message> {
    let filtered: Vec<&SessionLog> = match up_to_turn {
        Some(max) => log.iter().filter(|r| r.turn() <= max).collect(),
        None => log.iter().collect(),
    };

    let keep_from_turn = ctx
        .map(|c| c.keep_from_turn)
        .unwrap_or(0);

    let tool_names = if ctx.is_some() {
        tool_names_from_log(log)
    } else {
        HashMap::new()
    };

    let mut messages = Vec::new();
    let mut pending_tool_results: Vec<ContentBlock> = Vec::new();

    for record in filtered {
        match record {
            SessionLog::UserMessage { text, .. } => {
                flush_tool_results(&mut pending_tool_results, &mut messages);
                messages.push(Message {
                    role: Role::User,
                    content: MessageContent::Text(text.clone()),
                });
            }
            SessionLog::AssistantMessage { blocks, .. } => {
                flush_tool_results(&mut pending_tool_results, &mut messages);
                messages.push(Message {
                    role: Role::Assistant,
                    content: MessageContent::Blocks(blocks.clone()),
                });
            }
            SessionLog::ToolOutcome {
                tool_use_id,
                artifact_id,
                result_summary,
                ..
            } => {
                let tool_name = tool_names
                    .get(tool_use_id)
                    .map(String::as_str)
                    .unwrap_or("unknown");
                let text = project_tool_outcome(
                    record.turn(),
                    tool_name,
                    tool_use_id,
                    artifact_id.as_deref(),
                    result_summary,
                    ctx,
                    keep_from_turn,
                );
                pending_tool_results.push(ContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: moontide_protocol::ToolResultContent::Text(text),
                });
            }
            SessionLog::ToolInvocation { .. }
            | SessionLog::Compaction { .. }
            | SessionLog::CheckpointCreated { .. }
            | SessionLog::Routing { .. } => {}
        }
    }

    flush_tool_results(&mut pending_tool_results, &mut messages);
    messages
}

fn project_tool_outcome(
    turn: u32,
    tool_name: &str,
    _tool_use_id: &str,
    artifact_id: Option<&str>,
    summary: &ToolResultSummary,
    ctx: Option<&ProjectionContext>,
    keep_from_turn: u32,
) -> String {
    let Some(ctx) = ctx else {
        return summary.summary.clone();
    };

    let in_recent = turn >= keep_from_turn;
    let budget = ctx.inline_budget;

    if in_recent {
        if summary.truncated != Some(true) {
            return summary.summary.clone();
        }
        if let (Some(loader), Some(id)) = (&ctx.artifact_loader, artifact_id) {
            if let Some(full) = loader(id) {
                if full.chars().count() <= budget {
                    return full;
                }
                return format!(
                    "{}{}",
                    preview_chars(&full, budget),
                    format_truncation_suffix(tool_name, summary.byte_count, Some(id))
                );
            }
        }
    }

    truncation_footnote_for_tool(tool_name, summary, artifact_id)
}

fn format_truncation_suffix(tool_name: &str, byte_count: u32, artifact_id: Option<&str>) -> String {
    let artifact_hint = artifact_id
        .map(|id| format!("; artifact: {id}"))
        .unwrap_or_default();
    let mut suffix = format!(
        "… [truncated: {byte_count} bytes total{artifact_hint}]"
    );
    suffix.push_str(&moontide_tools::format_strategy_lines(tool_name, ""));
    suffix
}

fn flush_tool_results(pending: &mut Vec<ContentBlock>, messages: &mut Vec<Message>) {
    if pending.is_empty() {
        return;
    }
    messages.push(Message {
        role: Role::User,
        content: MessageContent::Blocks(std::mem::take(pending)),
    });
}

/// Build tool_use_id → tool_name map from log invocations.
pub fn tool_names_from_log(log: &[SessionLog]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for record in log {
        if let SessionLog::ToolInvocation {
            tool_use_id,
            name,
            ..
        } = record
        {
            map.insert(tool_use_id.clone(), name.clone());
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use moontide_protocol::{SessionLog, SessionLogBase, ToolResultSummary};
    use serde_json::json;

    fn base(id: &str, turn: u32) -> SessionLogBase {
        SessionLogBase {
            id: id.into(),
            session_id: "sess-1".into(),
            turn,
            at: "2026-07-31T08:00:00.000Z".into(),
        }
    }

    #[test]
    fn replays_user_then_assistant() {
        let log = vec![
            SessionLog::UserMessage {
                base: base("e1", 1),
                text: "hi".into(),
            },
            SessionLog::AssistantMessage {
                base: base("e2", 1),
                blocks: vec![ContentBlock::text("hello")],
            },
        ];

        let messages = log_to_messages(&log, None, None);
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn recent_turn_expands_artifact_inline() {
        let log = vec![
            SessionLog::UserMessage {
                base: base("e1", 1),
                text: "go".into(),
            },
            SessionLog::AssistantMessage {
                base: base("e2", 1),
                blocks: vec![ContentBlock::tool_use("toolu_1", "bash", json!({}))],
            },
            SessionLog::ToolOutcome {
                base: base("e3", 1),
                tool_use_id: "toolu_1".into(),
                artifact_id: Some("art_abc".into()),
                result_summary: ToolResultSummary {
                    summary: "preview…".into(),
                    byte_count: 100,
                    line_count: Some(1),
                    truncated: Some(true),
                },
            },
        ];

        let loader: ArtifactLoader = Arc::new(|id| {
            if id == "art_abc" {
                Some("full artifact body".into())
            } else {
                None
            }
        });
        let ctx = ProjectionContext {
            config: ToolProjectionConfig::from_env(),
            artifact_loader: Some(loader),
            inline_budget: 8192,
            keep_from_turn: 1,
        };

        let messages = log_to_messages(&log, None, Some(&ctx));
        match &messages[2].content {
            MessageContent::Blocks(blocks) => match &blocks[0] {
                ContentBlock::ToolResult { content, .. } => {
                    let text = match content {
                        moontide_protocol::ToolResultContent::Text(t) => t.as_str(),
                        moontide_protocol::ToolResultContent::Blocks(_) => "",
                    };
                    assert_eq!(text, "full artifact body");
                }
                _ => panic!("expected tool result"),
            },
            _ => panic!("expected blocks"),
        }
    }

    #[test]
    fn old_turn_shows_footnote_with_strategies() {
        let log = vec![
            SessionLog::UserMessage {
                base: base("e1", 1),
                text: "old".into(),
            },
            SessionLog::ToolOutcome {
                base: base("e2", 1),
                tool_use_id: "toolu_1".into(),
                artifact_id: Some("art_old".into()),
                result_summary: ToolResultSummary {
                    summary: "preview".into(),
                    byte_count: 5000,
                    line_count: None,
                    truncated: Some(true),
                },
            },
            SessionLog::UserMessage {
                base: base("e3", 2),
                text: "new".into(),
            },
            SessionLog::ToolOutcome {
                base: base("e4", 2),
                tool_use_id: "toolu_2".into(),
                artifact_id: Some("art_new".into()),
                result_summary: ToolResultSummary {
                    summary: "preview2".into(),
                    byte_count: 200,
                    line_count: None,
                    truncated: Some(true),
                },
            },
        ];

        let loader: ArtifactLoader = Arc::new(|id| Some(format!("FULL-{id}")));
        let ctx = ProjectionContext {
            config: ToolProjectionConfig {
                keep_turns: 1,
                ..ToolProjectionConfig::from_env()
            },
            artifact_loader: Some(loader),
            inline_budget: 8192,
            keep_from_turn: 2,
        };

        let messages = log_to_messages(&log, None, Some(&ctx));
        // Find first tool result (turn 1)
        let first_tool = messages
            .iter()
            .flat_map(|m| match &m.content {
                MessageContent::Blocks(b) => b.iter(),
                _ => [].iter(),
            })
            .find_map(|b| match b {
                ContentBlock::ToolResult { content, .. } => match content {
                    moontide_protocol::ToolResultContent::Text(t) => Some(t.clone()),
                    moontide_protocol::ToolResultContent::Blocks(_) => None,
                },
                _ => None,
            })
            .unwrap();
        assert!(first_tool.contains("[truncated:"));
        assert!(first_tool.contains("art_old"));
        assert!(first_tool.contains("[strategies]"));
    }
}
