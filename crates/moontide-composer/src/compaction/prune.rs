use moontide_protocol::{ContentBlock, Message, MessageContent, Role};

const COMPACT_PLACEHOLDER_PREFIX: &str = "[compact:";
const TOOL_RESULT_SHRINK_CHARS: usize = 120;

pub fn find_keep_from_index(messages: &[Message], keep_turns: u32) -> usize {
    let mut user_turns = 0u32;
    for (i, message) in messages.iter().enumerate().rev() {
        if !is_user_text_turn_start(message) {
            continue;
        }
        user_turns += 1;
        if user_turns >= keep_turns {
            return i;
        }
    }
    0
}

pub fn prune_messages(messages: Vec<Message>, keep_turns: u32) -> (Vec<Message>, u32) {
    if messages.is_empty() {
        return (messages, 0);
    }
    let keep_from = find_keep_from_index(&messages, keep_turns);
    let mut truncated_count = 0u32;
    let pruned = messages
        .into_iter()
        .enumerate()
        .map(|(i, msg)| {
            if i >= keep_from {
                return msg;
            }
            let (msg, n) = shrink_message_tool_results(msg);
            truncated_count += n;
            strip_thinking_from_assistant(msg)
        })
        .collect();
    (pruned, truncated_count)
}

fn is_tool_results_only(message: &Message) -> bool {
    match &message.content {
        MessageContent::Blocks(blocks) if !blocks.is_empty() => {
            blocks.iter().all(|b| matches!(b, ContentBlock::ToolResult { .. }))
        }
        _ => false,
    }
}

fn is_user_text_turn_start(message: &Message) -> bool {
    message.role == Role::User && !is_tool_results_only(message)
}

fn shrink_tool_result_content(content: &str) -> String {
    if content.starts_with(COMPACT_PLACEHOLDER_PREFIX) {
        return content.to_string();
    }
    format!("{COMPACT_PLACEHOLDER_PREFIX} {} chars omitted]", content.len())
}

fn shrink_message_tool_results(message: Message) -> (Message, u32) {
    let MessageContent::Blocks(blocks) = message.content else {
        return (message, 0);
    };

    let mut truncated = 0u32;
    let blocks = blocks
        .into_iter()
        .map(|block| match block {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
            } => {
                let body = match content {
                    moontide_protocol::ToolResultContent::Text(t) => t,
                    moontide_protocol::ToolResultContent::Blocks(_) => String::new(),
                };
                if body.len() <= TOOL_RESULT_SHRINK_CHARS
                    || body.starts_with(COMPACT_PLACEHOLDER_PREFIX)
                {
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content: moontide_protocol::ToolResultContent::Text(body),
                    }
                } else {
                    truncated += 1;
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content: moontide_protocol::ToolResultContent::Text(shrink_tool_result_content(
                            &body,
                        )),
                    }
                }
            }
            other => other,
        })
        .collect();

    (
        Message {
            content: MessageContent::Blocks(blocks),
            ..message
        },
        truncated,
    )
}

fn strip_thinking_from_assistant(message: Message) -> Message {
    if message.role != Role::Assistant {
        return message;
    }
    let MessageContent::Blocks(blocks) = message.content else {
        return message;
    };
    let blocks: Vec<_> = blocks
        .into_iter()
        .filter(|b| !matches!(b, ContentBlock::Thinking { .. }))
        .collect();
    Message {
        content: MessageContent::Blocks(blocks),
        ..message
    }
}

pub fn estimate_percent_used(messages: &[Message], system: &str, context_limit: usize) -> u32 {
    let chars = moontide_tools::estimate_messages_chars(messages) + system.len();
    if context_limit == 0 {
        return 0;
    }
    ((chars as f64 / context_limit as f64) * 100.0).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use moontide_protocol::ToolResultContent;

    #[test]
    fn old_tool_results_shrunk() {
        let long = "x".repeat(200);
        let messages = vec![
            Message {
                role: Role::User,
                content: MessageContent::Text("hello".into()),
            },
            Message {
                role: Role::User,
                content: MessageContent::Blocks(vec![ContentBlock::ToolResult {
                    tool_use_id: "t1".into(),
                    content: ToolResultContent::Text(long.clone()),
                }]),
            },
            Message {
                role: Role::User,
                content: MessageContent::Text("again".into()),
            },
        ];
        let (pruned, n) = prune_messages(messages, 1);
        assert!(n >= 1);
        match &pruned[1].content {
            MessageContent::Blocks(blocks) => match &blocks[0] {
                ContentBlock::ToolResult { content, .. } => match content {
                    ToolResultContent::Text(t) => assert!(t.starts_with(COMPACT_PLACEHOLDER_PREFIX)),
                    ToolResultContent::Blocks(_) => {}
                },
                _ => panic!(),
            },
            _ => panic!(),
        }
    }
}
