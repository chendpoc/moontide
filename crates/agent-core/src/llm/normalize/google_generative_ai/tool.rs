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
    ToolSchema,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiRequestBody {
    pub contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_config: Option<GeminiGenerationConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<GeminiTool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiGenerationConfig {
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiContent {
    pub role: String,
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum GeminiPart {
    Text {
        text: String,
    },
    FunctionCall {
        #[serde(rename = "functionCall")]
        function_call: GeminiFunctionCall,
    },
    FunctionResponse {
        #[serde(rename = "functionResponse")]
        function_response: GeminiFunctionResponse,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiFunctionCall {
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiFunctionResponse {
    pub name: String,
    pub response: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiTool {
    #[serde(rename = "functionDeclarations")]
    pub function_declarations: Vec<GeminiFunctionDeclaration>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeminiFunctionDeclaration {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub fn encode_tools(tools: &[ToolSchema]) -> Vec<GeminiTool> {
    vec![GeminiTool {
        function_declarations: tools
            .iter()
            .map(|tool| GeminiFunctionDeclaration {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: tool.input_schema.clone(),
            })
            .collect(),
    }]
}

pub fn encode_contents(messages: &[Message]) -> Result<Vec<GeminiContent>, LlmError> {
    let mut out = Vec::new();
    for message in messages {
        encode_message(message, &mut out)?;
    }
    Ok(out)
}

fn encode_message(message: &Message, out: &mut Vec<GeminiContent>) -> Result<(), LlmError> {
    match message.role {
        Role::User => encode_user_message(message, out),
        Role::Assistant => encode_assistant_message(message, out),
        Role::System => Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "system messages belong in ModelRequest.system, not messages[]".into(),
        }),
    }
}

fn encode_user_message(message: &Message, out: &mut Vec<GeminiContent>) -> Result<(), LlmError> {
    match &message.content {
        MessageContent::Text(text) => {
            out.push(GeminiContent {
                role: "user".into(),
                parts: vec![GeminiPart::Text { text: text.clone() }],
            });
        }
        MessageContent::Blocks(blocks) => {
            let mut parts = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text } => {
                        parts.push(GeminiPart::Text { text: text.clone() })
                    }
                    ContentBlock::ToolResult {
                        tool_use_id: _,
                        content,
                    } => parts.push(GeminiPart::FunctionResponse {
                        function_response: GeminiFunctionResponse {
                            name: String::new(),
                            response: Value::String(tool_result_to_string(content)),
                        },
                    }),
                    ContentBlock::Thinking { .. } | ContentBlock::ToolUse { .. } => {
                        return Err(invalid_block("user", block));
                    }
                }
            }
            if !parts.is_empty() {
                out.push(GeminiContent {
                    role: "user".into(),
                    parts,
                });
            }
        }
    }
    Ok(())
}

fn encode_assistant_message(
    message: &Message,
    out: &mut Vec<GeminiContent>,
) -> Result<(), LlmError> {
    match &message.content {
        MessageContent::Text(text) => {
            out.push(GeminiContent {
                role: "model".into(),
                parts: vec![GeminiPart::Text { text: text.clone() }],
            });
        }
        MessageContent::Blocks(blocks) => {
            let mut parts = Vec::new();
            for block in blocks {
                match block {
                    ContentBlock::Text { text } => {
                        parts.push(GeminiPart::Text { text: text.clone() })
                    }
                    ContentBlock::Thinking { .. } => {}
                    ContentBlock::ToolUse { name, input, .. } => {
                        parts.push(GeminiPart::FunctionCall {
                            function_call: GeminiFunctionCall {
                                name: name.clone(),
                                args: input.clone(),
                            },
                        });
                    }
                    ContentBlock::ToolResult { .. } => {
                        return Err(invalid_block("assistant", block));
                    }
                }
            }
            if !parts.is_empty() {
                out.push(GeminiContent {
                    role: "model".into(),
                    parts,
                });
            }
        }
    }
    Ok(())
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
