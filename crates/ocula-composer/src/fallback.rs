use std::collections::HashMap;

use ocula_protocol::{ContentBlock, Message, MessageContent, Role, SessionLog};
use ocula_tools::{preview_chars, ToolProjectionConfig};

use crate::log_to_messages::tool_names_from_log;

#[derive(Debug, Clone)]
pub struct TruncatedOutcome {
    pub tool_use_id: String,
    pub tool_name: String,
    pub artifact_id: Option<String>,
    pub byte_count: u32,
    pub turn: u32,
}

pub fn collect_truncated_in_window(
    log: &[SessionLog],
    keep_from_turn: u32,
) -> Vec<TruncatedOutcome> {
    let names = tool_names_from_log(log);
    log.iter()
        .filter_map(|record| {
            let SessionLog::ToolOutcome {
                tool_use_id,
                artifact_id,
                result_summary,
                ..
            } = record
            else {
                return None;
            };
            if record.turn() < keep_from_turn || result_summary.truncated != Some(true) {
                return None;
            }
            Some(TruncatedOutcome {
                tool_use_id: tool_use_id.clone(),
                tool_name: names
                    .get(tool_use_id)
                    .cloned()
                    .unwrap_or_else(|| "unknown".into()),
                artifact_id: artifact_id.clone(),
                byte_count: result_summary.byte_count,
                turn: record.turn(),
            })
        })
        .collect()
}

/// Greedy expand truncated outcomes from artifacts up to remaining budget.
pub fn apply_truncation_fallback(
    messages: Vec<Message>,
    truncated: &[TruncatedOutcome],
    artifact_loader: &dyn Fn(&str) -> Option<String>,
    mut remaining_budget: usize,
) -> (Vec<Message>, bool) {
    if truncated.len() < 2 || remaining_budget == 0 {
        return (messages, false);
    }

    let mut sorted = truncated.to_vec();
    sorted.sort_by_key(|t| t.byte_count);

    let mut expanded: HashMap<String, String> = HashMap::new();
    for item in &sorted {
        let Some(id) = &item.artifact_id else {
            continue;
        };
        let Some(full) = artifact_loader(id) else {
            continue;
        };
        let chars = full.chars().count();
        if chars <= remaining_budget {
            remaining_budget -= chars;
            expanded.insert(item.tool_use_id.clone(), full);
        } else if remaining_budget > 0 {
            let partial = preview_chars(&full, remaining_budget);
            remaining_budget = 0;
            expanded.insert(
                item.tool_use_id.clone(),
                format!("{partial}… [partial expand; artifact: {id}]"),
            );
        }
    }

    if expanded.is_empty() {
        return (messages, false);
    }

    let updated = messages
        .into_iter()
        .map(|m| expand_tool_results_in_message(m, &expanded))
        .collect();
    (updated, true)
}

pub fn build_truncation_bundle_message(truncated: &[TruncatedOutcome], loader: &dyn Fn(&str) -> Option<String>) -> Option<Message> {
    if truncated.len() < 2 {
        return None;
    }

    let mut lines = vec!["[ocula: truncated tool outputs bundle]".into()];
    for item in truncated {
        let body = item
            .artifact_id
            .as_ref()
            .and_then(|id| loader(id))
            .map(|full| {
                if full.chars().count() <= 2000 {
                    full
                } else {
                    format!("{}…", preview_chars(&full, 2000))
                }
            })
            .unwrap_or_else(|| format!("see read_artifact {}", item.artifact_id.as_deref().unwrap_or("?")));
        lines.push(format!(
            "tool {} ({}B): {}",
            item.tool_name, item.byte_count, body
        ));
    }

    Some(Message {
        role: Role::User,
        content: MessageContent::Text(lines.join("\n")),
    })
}

fn expand_tool_results_in_message(message: Message, expanded: &HashMap<String, String>) -> Message {
    let MessageContent::Blocks(blocks) = message.content else {
        return message;
    };

    let blocks = blocks
        .into_iter()
        .map(|block| match block {
            ContentBlock::ToolResult {
                tool_use_id,
                content: _,
            } if expanded.contains_key(&tool_use_id) => ContentBlock::ToolResult {
                tool_use_id: tool_use_id.clone(),
                content: ocula_protocol::ToolResultContent::Text(
                    expanded.get(&tool_use_id).cloned().unwrap_or_default(),
                ),
            },
            other => other,
        })
        .collect();

    Message {
        content: MessageContent::Blocks(blocks),
        ..message
    }
}

pub fn remaining_budget_after_messages(
    config: &ToolProjectionConfig,
    messages: &[Message],
    system_chars: usize,
) -> usize {
    let used = ocula_tools::estimate_messages_chars(messages) + system_chars;
    config.dynamic_inline_budget(used)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ocula_protocol::{SessionLog, SessionLogBase, ToolResultSummary};
    use serde_json::json;

    fn base(id: &str, turn: u32) -> SessionLogBase {
        SessionLogBase {
            id: id.into(),
            session_id: "s".into(),
            turn,
            at: "t".into(),
        }
    }

    #[test]
    fn greedy_expands_smallest_first() {
        let truncated = vec![
            TruncatedOutcome {
                tool_use_id: "a".into(),
                tool_name: "bash".into(),
                artifact_id: Some("art_big".into()),
                byte_count: 10000,
                turn: 1,
            },
            TruncatedOutcome {
                tool_use_id: "b".into(),
                tool_name: "grep".into(),
                artifact_id: Some("art_small".into()),
                byte_count: 100,
                turn: 1,
            },
        ];
        let loader = |id: &str| -> Option<String> {
            Some(match id {
                "art_small" => "small".into(),
                "art_big" => "x".repeat(500),
                _ => return None,
            })
        };
        let messages = vec![Message {
            role: Role::User,
            content: MessageContent::Blocks(vec![
                ContentBlock::ToolResult {
                    tool_use_id: "a".into(),
                    content: ocula_protocol::ToolResultContent::Text("trunc".into()),
                },
                ContentBlock::ToolResult {
                    tool_use_id: "b".into(),
                    content: ocula_protocol::ToolResultContent::Text("trunc".into()),
                },
            ]),
        }];
        let (out, changed) = apply_truncation_fallback(messages, &truncated, &loader, 200);
        assert!(changed);
        match &out[0].content {
            MessageContent::Blocks(blocks) => {
                let b_text = match &blocks[1] {
                    ContentBlock::ToolResult { content, .. } => match content {
                        ocula_protocol::ToolResultContent::Text(t) => t.clone(),
                        ocula_protocol::ToolResultContent::Blocks(_) => String::new(),
                    },
                    _ => panic!(),
                };
                assert_eq!(b_text, "small");
            }
            _ => panic!(),
        }
    }

    #[test]
    fn collect_truncated_respects_window() {
        let log = vec![
            SessionLog::ToolOutcome {
                base: base("1", 1),
                tool_use_id: "t1".into(),
                artifact_id: Some("a1".into()),
                result_summary: ToolResultSummary {
                    summary: "p".into(),
                    byte_count: 100,
                    line_count: None,
                    truncated: Some(true),
                },
            },
            SessionLog::ToolInvocation {
                base: base("2", 1),
                tool_use_id: "t1".into(),
                name: "bash".into(),
                input: json!({}),
            },
        ];
        assert_eq!(collect_truncated_in_window(&log, 1).len(), 1);
        assert_eq!(collect_truncated_in_window(&log, 2).len(), 0);
    }
}
