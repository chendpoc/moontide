use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::llm::protocol::{
    ContentBlock, LlmError, Message, MessageContent, RequestFailureKind, Role, ToolResultContent,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiChatRequestBody {
    pub model: String,
    pub messages: Vec<OpenAiChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OpenAiToolDefinition>>,
    pub max_tokens: u32,
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OpenAiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiToolCall {
    pub id: String,
    pub r#type: String,
    pub function: OpenAiFunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiFunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiToolDefinition {
    pub r#type: String,
    pub function: OpenAiFunctionDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiFunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// MoonTide conversation → OpenAI Chat messages (excluding system).
pub fn encode_messages(messages: &[Message]) -> Result<Vec<OpenAiChatMessage>, LlmError> {
    let mut out = Vec::new();
    for message in messages {
        encode_message(message, &mut out)?;
    }
    Ok(out)
}

fn encode_message(message: &Message, out: &mut Vec<OpenAiChatMessage>) -> Result<(), LlmError> {
    match message.role {
        Role::User => encode_user_message(message, out),
        Role::Assistant => encode_assistant_message(message, out),
        Role::System => Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "system messages belong in ModelRequest.system, not messages[]".into(),
        }),
    }
}

fn encode_user_message(
    message: &Message,
    out: &mut Vec<OpenAiChatMessage>,
) -> Result<(), LlmError> {
    match &message.content {
        MessageContent::Text(text) => {
            out.push(OpenAiChatMessage {
                role: "user".into(),
                content: Some(text.clone()),
                reasoning_content: None,
                tool_calls: None,
                tool_call_id: None,
            });
        }
        MessageContent::Blocks(blocks) => {
            let mut text_parts = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text } => text_parts.push(text.clone()),
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    } => {
                        flush_user_text(&mut text_parts, out);
                        out.push(OpenAiChatMessage {
                            role: "tool".into(),
                            content: Some(tool_result_to_string(content)),
                            reasoning_content: None,
                            tool_calls: None,
                            tool_call_id: Some(tool_use_id.clone()),
                        });
                    }
                    ContentBlock::Thinking { .. } | ContentBlock::ToolUse { .. } => {
                        return Err(invalid_block("user", block));
                    }
                }
            }
            flush_user_text(&mut text_parts, out);
        }
    }
    Ok(())
}

fn encode_assistant_message(
    message: &Message,
    out: &mut Vec<OpenAiChatMessage>,
) -> Result<(), LlmError> {
    match &message.content {
        MessageContent::Text(text) => {
            out.push(OpenAiChatMessage {
                role: "assistant".into(),
                content: Some(text.clone()),
                reasoning_content: None,
                tool_calls: None,
                tool_call_id: None,
            });
        }
        MessageContent::Blocks(blocks) => {
            let mut text = String::new();
            let mut reasoning = String::new();
            let mut tool_calls = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text: part } => text.push_str(part),
                    ContentBlock::Thinking { thinking } => reasoning.push_str(thinking),
                    ContentBlock::ToolUse { id, name, input } => {
                        tool_calls.push(OpenAiToolCall {
                            id: id.clone(),
                            r#type: "function".into(),
                            function: OpenAiFunctionCall {
                                name: name.clone(),
                                arguments: serde_json::to_string(input).map_err(|e| {
                                    LlmError::RequestFailed {
                                        kind: RequestFailureKind::Unrecoverable,
                                        message: format!("tool input serialize: {e}"),
                                    }
                                })?,
                            },
                        });
                    }
                    ContentBlock::ToolResult { .. } => {
                        return Err(invalid_block("assistant", block));
                    }
                }
            }
            out.push(OpenAiChatMessage {
                role: "assistant".into(),
                content: if text.is_empty() { None } else { Some(text) },
                reasoning_content: if reasoning.is_empty() {
                    None
                } else {
                    Some(reasoning)
                },
                tool_calls: if tool_calls.is_empty() {
                    None
                } else {
                    Some(tool_calls)
                },
                tool_call_id: None,
            });
        }
    }
    Ok(())
}

fn flush_user_text(parts: &mut Vec<String>, out: &mut Vec<OpenAiChatMessage>) {
    if parts.is_empty() {
        return;
    }
    out.push(OpenAiChatMessage {
        role: "user".into(),
        content: Some(parts.join("")),
        reasoning_content: None,
        tool_calls: None,
        tool_call_id: None,
    });
    parts.clear();
}

fn tool_result_to_string(content: &ToolResultContent) -> String {
    match content {
        ToolResultContent::Text(text) => text.clone(),
        ToolResultContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(""),
    }
}

/// OpenAI Chat messages → MoonTide conversation.
/// 当前仅 round-trip 测试使用（验证 `encode_messages` 可逆）；生产接线时移除 `#[cfg(test)]`。
#[cfg(test)]
pub fn decode_messages(messages: &[OpenAiChatMessage]) -> Result<Vec<Message>, LlmError> {
    let mut out = Vec::new();
    for message in messages {
        if message.role == "system" {
            continue;
        }
        if message.role == "tool" {
            let tool_use_id =
                message
                    .tool_call_id
                    .clone()
                    .ok_or_else(|| LlmError::RequestFailed {
                        kind: RequestFailureKind::Unrecoverable,
                        message: "tool message missing tool_call_id".into(),
                    })?;
            out.push(Message {
                role: Role::User,
                content: MessageContent::Blocks(vec![ContentBlock::ToolResult {
                    tool_use_id,
                    content: ToolResultContent::Text(message.content.clone().unwrap_or_default()),
                }]),
            });
            continue;
        }

        let role = match message.role.as_str() {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            other => {
                return Err(LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    message: format!("unsupported openai role: {other}"),
                });
            }
        };

        let mut blocks = Vec::new();
        if let Some(reasoning) = &message.reasoning_content {
            if !reasoning.is_empty() {
                blocks.push(ContentBlock::Thinking {
                    thinking: reasoning.clone(),
                });
            }
        }
        if let Some(text) = &message.content {
            if !text.is_empty() {
                blocks.push(ContentBlock::Text { text: text.clone() });
            }
        }
        if let Some(tool_calls) = &message.tool_calls {
            for call in tool_calls {
                let input = serde_json::from_str(&call.function.arguments).unwrap_or(Value::Null);
                blocks.push(ContentBlock::ToolUse {
                    id: call.id.clone(),
                    name: call.function.name.clone(),
                    input,
                });
            }
        }

        let content = if blocks.is_empty() {
            MessageContent::Text(String::new())
        } else if blocks.len() == 1 {
            match blocks.into_iter().next() {
                Some(ContentBlock::Text { text }) => MessageContent::Text(text),
                Some(block) => MessageContent::Blocks(vec![block]),
                None => MessageContent::Text(String::new()),
            }
        } else {
            MessageContent::Blocks(blocks)
        };

        out.push(Message { role, content });
    }
    Ok(out)
}

fn invalid_block(role: &str, block: &ContentBlock) -> LlmError {
    LlmError::RequestFailed {
        kind: RequestFailureKind::Unrecoverable,
        message: format!("invalid {role} block: {block:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trip_user_and_assistant_text() {
        let original = vec![
            Message {
                role: Role::User,
                content: MessageContent::Text("hello".into()),
            },
            Message {
                role: Role::Assistant,
                content: MessageContent::Text("hi".into()),
            },
        ];
        let wire = encode_messages(&original).expect("encode");
        let back = decode_messages(&wire).expect("decode");
        assert_eq!(original, back);
    }

    #[test]
    fn round_trip_tool_use_and_result() {
        let original = vec![
            Message {
                role: Role::Assistant,
                content: MessageContent::Blocks(vec![ContentBlock::ToolUse {
                    id: "call_1".into(),
                    name: "read_file".into(),
                    input: json!({"path": "a.rs"}),
                }]),
            },
            Message {
                role: Role::User,
                content: MessageContent::Blocks(vec![ContentBlock::ToolResult {
                    tool_use_id: "call_1".into(),
                    content: ToolResultContent::Text("fn main() {}".into()),
                }]),
            },
        ];
        let wire = encode_messages(&original).expect("encode");
        assert_eq!(wire.len(), 2);
        assert_eq!(wire[0].role, "assistant");
        assert!(wire[0].tool_calls.is_some());
        assert_eq!(wire[1].role, "tool");
        let back = decode_messages(&wire).expect("decode");
        assert_eq!(original, back);
    }

    #[test]
    fn round_trip_thinking_on_assistant() {
        let original = vec![Message {
            role: Role::Assistant,
            content: MessageContent::Blocks(vec![
                ContentBlock::Thinking {
                    thinking: "plan".into(),
                },
                ContentBlock::Text {
                    text: "answer".into(),
                },
            ]),
        }];
        let wire = encode_messages(&original).expect("encode");
        assert_eq!(wire[0].reasoning_content.as_deref(), Some("plan"));
        let back = decode_messages(&wire).expect("decode");
        match &back[0].content {
            MessageContent::Blocks(blocks) => assert_eq!(blocks.len(), 2),
            other => panic!("expected blocks, got {other:?}"),
        }
    }
}
