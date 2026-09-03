use serde::{
    Deserialize,
    Serialize,
};
use serde_json::Value;

use crate::llm::protocol::{
    ContentBlock,
    LlmError,
    Message,
    MessageContent,
    RequestFailureKind,
    Role,
    ToolResultContent,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnthropicRequestBody {
    pub model: String,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<Vec<AnthropicSystemBlock>>,
    pub messages: Vec<AnthropicMessage>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<AnthropicToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<super::AnthropicThinkingConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnthropicSystemBlock {
    pub r#type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnthropicToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub fn encode_messages(messages: &[Message]) -> Result<Vec<AnthropicMessage>, LlmError> {
    let mut out = Vec::new();
    for message in messages {
        out.push(encode_message(message)?);
    }
    Ok(out)
}

fn encode_message(message: &Message) -> Result<AnthropicMessage, LlmError> {
    let role = match message.role {
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::System => {
            return Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: "system messages belong in ModelRequest.system, not messages[]".into(),
            });
        }
    };
    Ok(AnthropicMessage {
        role: role.into(),
        content: encode_content(&message.content, message.role)?,
    })
}

fn encode_content(content: &MessageContent, role: Role) -> Result<Value, LlmError> {
    match content {
        MessageContent::Text(text) => Ok(Value::String(text.clone())),
        MessageContent::Blocks(blocks) => {
            let mut wire_blocks = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text } => {
                        wire_blocks.push(serde_json::json!({
                            "type": "text",
                            "text": text,
                        }));
                    }
                    ContentBlock::Thinking { thinking } if role == Role::Assistant => {
                        wire_blocks.push(serde_json::json!({
                            "type": "thinking",
                            "thinking": thinking,
                        }));
                    }
                    ContentBlock::ToolUse { id, name, input } if role == Role::Assistant => {
                        wire_blocks.push(serde_json::json!({
                            "type": "tool_use",
                            "id": id,
                            "name": name,
                            "input": input,
                        }));
                    }
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    } if role == Role::User => {
                        wire_blocks.push(serde_json::json!({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": tool_result_to_string(content),
                        }));
                    }
                    other => return Err(invalid_block(role, other)),
                }
            }
            Ok(Value::Array(wire_blocks))
        }
    }
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

fn invalid_block(role: Role, block: &ContentBlock) -> LlmError {
    LlmError::RequestFailed {
        kind: RequestFailureKind::Unrecoverable,
        message: format!("invalid {role:?} block: {block:?}"),
    }
}
