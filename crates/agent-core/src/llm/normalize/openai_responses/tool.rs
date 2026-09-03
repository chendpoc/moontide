use serde::{
    Deserialize,
    Serialize,
};
use serde_json::{
    Value,
    json,
};

use crate::llm::protocol::{
    ContentBlock,
    LlmError,
    Message,
    MessageContent,
    ModelRequest,
    RequestFailureKind,
    Role,
    ToolResultContent,
    ToolSchema,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAiResponsesRequestBody {
    pub model: String,
    pub input: Value,
    pub stream: bool,
    pub max_output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_response_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ResponsesToolDefinition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResponsesToolDefinition {
    pub r#type: String,
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub fn encode_tools(tools: &[ToolSchema]) -> Vec<ResponsesToolDefinition> {
    tools
        .iter()
        .map(|tool| ResponsesToolDefinition {
            r#type: "function".into(),
            name: tool.name.clone(),
            description: tool.description.clone(),
            parameters: tool.input_schema.clone(),
        })
        .collect()
}

pub fn encode_input(request: &ModelRequest) -> Result<Value, LlmError> {
    let mut items = Vec::new();
    if !request.system.is_empty() {
        items.push(json!({
            "role": "developer",
            "content": request.system,
        }));
    }
    for message in &request.messages {
        items.push(encode_message(message)?);
    }
    Ok(Value::Array(items))
}

fn encode_message(message: &Message) -> Result<Value, LlmError> {
    match message.role {
        Role::User => encode_user_message(message),
        Role::Assistant => encode_assistant_message(message),
        Role::System => Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "system messages belong in ModelRequest.system, not messages[]".into(),
        }),
    }
}

fn encode_user_message(message: &Message) -> Result<Value, LlmError> {
    match &message.content {
        MessageContent::Text(text) => Ok(json!({
            "role": "user",
            "content": text,
        })),
        MessageContent::Blocks(blocks) => {
            let mut text_parts = Vec::new();
            let mut items = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text } => text_parts.push(text.clone()),
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    } => {
                        flush_user_text(&mut text_parts, &mut items);
                        items.push(json!({
                            "type": "function_call_output",
                            "call_id": tool_use_id,
                            "output": tool_result_to_string(content),
                        }));
                    }
                    ContentBlock::Thinking { .. } | ContentBlock::ToolUse { .. } => {
                        return Err(invalid_block("user", block));
                    }
                }
            }
            flush_user_text(&mut text_parts, &mut items);
            if items.len() == 1 {
                let single = items.pop().ok_or_else(|| LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    message: "expected single encoded user item".into(),
                })?;
                Ok(single)
            } else {
                Ok(json!({ "role": "user", "content": items }))
            }
        }
    }
}

fn encode_assistant_message(message: &Message) -> Result<Value, LlmError> {
    match &message.content {
        MessageContent::Text(text) => Ok(json!({
            "role": "assistant",
            "content": text,
        })),
        MessageContent::Blocks(blocks) => {
            let mut text = String::new();
            let mut items = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text: part } => text.push_str(part),
                    ContentBlock::Thinking { .. } => {}
                    ContentBlock::ToolUse { id, name, input } => {
                        items.push(json!({
                            "type": "function_call",
                            "call_id": id,
                            "name": name,
                            "arguments": serde_json::to_string(input).map_err(|e| {
                                LlmError::RequestFailed {
                                    kind: RequestFailureKind::Unrecoverable,
                                    message: format!("tool input serialize: {e}"),
                                }
                            })?,
                        }));
                    }
                    ContentBlock::ToolResult { .. } => {
                        return Err(invalid_block("assistant", block));
                    }
                }
            }
            if !text.is_empty() {
                items.insert(
                    0,
                    json!({
                        "type": "output_text",
                        "text": text,
                    }),
                );
            }
            Ok(json!({ "role": "assistant", "content": items }))
        }
    }
}

fn flush_user_text(parts: &mut Vec<String>, items: &mut Vec<Value>) {
    if parts.is_empty() {
        return;
    }
    items.push(json!({
        "role": "user",
        "content": parts.join(""),
    }));
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

fn invalid_block(role: &str, block: &ContentBlock) -> LlmError {
    LlmError::RequestFailed {
        kind: RequestFailureKind::Unrecoverable,
        message: format!("invalid {role} block: {block:?}"),
    }
}
