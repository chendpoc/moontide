use ocula_protocol::{ContentBlock, Message, MessageContent, Role, SessionLog};

pub fn log_to_messages(log: &[SessionLog], up_to_turn: Option<u32>) -> Vec<Message> {
    let filtered: Vec<&SessionLog> = match up_to_turn {
        Some(max) => log.iter().filter(|r| r.turn() <= max).collect(),
        None => log.iter().collect(),
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
                result_summary,
                ..
            } => {
                pending_tool_results.push(ContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: ocula_protocol::ToolResultContent::Text(result_summary.summary.clone()),
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

fn flush_tool_results(pending: &mut Vec<ContentBlock>, messages: &mut Vec<Message>) {
    if pending.is_empty() {
        return;
    }
    messages.push(Message {
        role: Role::User,
        content: MessageContent::Blocks(std::mem::take(pending)),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use ocula_protocol::{SessionLog, SessionLogBase, ToolResultSummary};
    use serde_json::json;

    fn base(id: &str) -> SessionLogBase {
        SessionLogBase {
            id: id.into(),
            session_id: "sess-1".into(),
            turn: 1,
            at: "2026-07-31T08:00:00.000Z".into(),
        }
    }

    #[test]
    fn replays_user_then_assistant() {
        let log = vec![
            SessionLog::UserMessage {
                base: base("e1"),
                text: "hi".into(),
            },
            SessionLog::AssistantMessage {
                base: base("e2"),
                blocks: vec![ContentBlock::text("hello")],
            },
        ];

        let messages = log_to_messages(&log, None);
        assert_eq!(messages.len(), 2);
        match &messages[0].content {
            MessageContent::Text(t) => assert_eq!(t, "hi"),
            _ => panic!("expected text user message"),
        }
    }

    #[test]
    fn merges_tool_outcome_into_user_tool_result() {
        let log = vec![
            SessionLog::UserMessage {
                base: base("e1"),
                text: "read file".into(),
            },
            SessionLog::AssistantMessage {
                base: base("e2"),
                blocks: vec![ContentBlock::tool_use(
                    "toolu_1",
                    "read_file",
                    json!({ "path": "a.txt" }),
                )],
            },
            SessionLog::ToolOutcome {
                base: base("e3"),
                tool_use_id: "toolu_1".into(),
                artifact_id: None,
                result_summary: ToolResultSummary {
                    summary: "contents".into(),
                    byte_count: 8,
                    line_count: None,
                    truncated: None,
                },
            },
            SessionLog::AssistantMessage {
                base: base("e4"),
                blocks: vec![ContentBlock::text("done")],
            },
        ];

        let messages = log_to_messages(&log, None);
        assert_eq!(messages.len(), 4);
        match &messages[2].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                assert!(matches!(blocks[0], ContentBlock::ToolResult { .. }));
            }
            _ => panic!("expected tool result user message"),
        }
    }
}
