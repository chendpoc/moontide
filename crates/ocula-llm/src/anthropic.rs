use anyhow::{Context, Result};
use async_trait::async_trait;
use ocula_protocol::{ContentBlock, Message, MessageContent, ToolSchema};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::LlmConfig;

#[derive(Debug, Clone, Serialize)]
struct MessagesRequest {
    model: String,
    system: String,
    messages: Vec<ApiMessage>,
    tools: Vec<ToolSchema>,
    max_tokens: u32,
}

#[derive(Debug, Clone, Serialize)]
struct ApiMessage {
    role: String,
    content: Value,
}

#[derive(Debug, Clone, Deserialize)]
struct MessagesResponse {
    content: Vec<ApiContentBlock>,
    stop_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ApiContentBlock {
    Text { text: String },
    Thinking { thinking: String },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn chat(
        &self,
        messages: &[Message],
        tools: &[ToolSchema],
        system: &str,
    ) -> Result<LlmChatResponse>;
}

pub struct LlmChatResponse {
    pub content: Vec<ContentBlock>,
    pub stop_reason: String,
}

pub struct AnthropicClient {
    http: Client,
    config: LlmConfig,
}

impl AnthropicClient {
    pub fn new(config: LlmConfig) -> Self {
        Self {
            http: Client::new(),
            config,
        }
    }

    pub fn from_env() -> Result<Self> {
        Ok(Self::new(LlmConfig::from_env()?))
    }
}

#[async_trait]
impl LlmClient for AnthropicClient {
    async fn chat(
        &self,
        messages: &[Message],
        tools: &[ToolSchema],
        system: &str,
    ) -> Result<LlmChatResponse> {
        let api_messages: Vec<ApiMessage> = messages
            .iter()
            .map(|m| ApiMessage {
                role: match m.role {
                    ocula_protocol::Role::User => "user".into(),
                    ocula_protocol::Role::Assistant => "assistant".into(),
                },
                content: message_to_api_content(&m.content),
            })
            .collect();

        let body = MessagesRequest {
            model: self.config.model_id.clone(),
            system: system.to_string(),
            messages: api_messages,
            tools: tools.to_vec(),
            max_tokens: self.config.max_tokens,
        };

        let url = format!(
            "{}/v1/messages",
            self.config.base_url.trim_end_matches('/')
        );
        let response = self
            .http
            .post(url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .context("LLM request failed")?
            .error_for_status()
            .context("LLM API error")?
            .json::<MessagesResponse>()
            .await
            .context("parse LLM response")?;

        Ok(LlmChatResponse {
            content: response
                .content
                .into_iter()
                .map(api_block_to_protocol)
                .collect(),
            stop_reason: response.stop_reason.unwrap_or_else(|| "end_turn".into()),
        })
    }
}

fn message_to_api_content(content: &MessageContent) -> Value {
    match content {
        MessageContent::Text(text) => Value::String(text.clone()),
        MessageContent::Blocks(blocks) => {
            Value::Array(blocks.iter().map(protocol_block_to_api).collect())
        }
    }
}

fn protocol_block_to_api(block: &ContentBlock) -> Value {
    match block {
        ContentBlock::Text { text } => serde_json::json!({ "type": "text", "text": text }),
        ContentBlock::Thinking { thinking } => {
            serde_json::json!({ "type": "thinking", "thinking": thinking })
        }
        ContentBlock::ToolUse { id, name, input } => serde_json::json!({
            "type": "tool_use", "id": id, "name": name, "input": input
        }),
        ContentBlock::ToolResult {
            tool_use_id,
            content,
        } => {
            let content_val = match content {
                ocula_protocol::ToolResultContent::Text(t) => Value::String(t.clone()),
                ocula_protocol::ToolResultContent::Blocks(b) => {
                    Value::Array(b.iter().map(protocol_block_to_api).collect())
                }
            };
            serde_json::json!({
                "type": "tool_result", "tool_use_id": tool_use_id, "content": content_val
            })
        }
    }
}

fn api_block_to_protocol(block: ApiContentBlock) -> ContentBlock {
    match block {
        ApiContentBlock::Text { text } => ContentBlock::Text { text },
        ApiContentBlock::Thinking { thinking } => ContentBlock::Thinking { thinking },
        ApiContentBlock::ToolUse { id, name, input } => ContentBlock::ToolUse { id, name, input },
    }
}

pub fn extract_text(content: &[ContentBlock]) -> String {
    content
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}
