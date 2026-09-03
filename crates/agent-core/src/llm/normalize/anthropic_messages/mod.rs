pub mod stream;
pub mod tool;

use serde::{
    Deserialize,
    Serialize,
};
use serde_json::json;
pub use stream::{
    AnthropicStreamEvent,
    StreamDecoder,
};
use tool::{
    AnthropicRequestBody,
    AnthropicSystemBlock,
    encode_messages,
};

use super::common::{
    HandoffPolicy,
    sanitize_messages_for_handoff,
    validate_request,
};
use crate::llm::protocol::{
    LlmError,
    ModelRequest,
    ThinkingLevel,
};

/// Encode options for Anthropic Messages wire body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodeOptions {
    pub prompt_cache: bool,
}

pub fn encode_request(
    request: &ModelRequest,
    options: EncodeOptions,
) -> Result<AnthropicRequestBody, LlmError> {
    validate_request(request)?;

    let messages =
        sanitize_messages_for_handoff(request.messages.clone(), HandoffPolicy::ANTHROPIC_MESSAGES);
    let wire_messages = encode_messages(&messages)?;

    let system = if request.system.is_empty() {
        None
    } else if options.prompt_cache {
        Some(vec![AnthropicSystemBlock {
            r#type: "text".into(),
            text: request.system.clone(),
            cache_control: Some(json!({"type": "ephemeral"})),
        }])
    } else {
        Some(vec![AnthropicSystemBlock {
            r#type: "text".into(),
            text: request.system.clone(),
            cache_control: None,
        }])
    };

    let tools = if request.tools.is_empty() {
        None
    } else {
        Some(
            request
                .tools
                .iter()
                .map(|tool| tool::AnthropicToolDefinition {
                    name: tool.name.clone(),
                    description: tool.description.clone(),
                    input_schema: tool.input_schema.clone(),
                })
                .collect(),
        )
    };

    Ok(AnthropicRequestBody {
        model: request.model.clone(),
        max_tokens: request.max_tokens,
        system,
        messages: wire_messages,
        stream: true,
        tools,
        thinking: encode_thinking(request.thinking_level),
    })
}

fn encode_thinking(level: Option<ThinkingLevel>) -> Option<AnthropicThinkingConfig> {
    let budget = match level {
        Some(ThinkingLevel::Low) => 1_024,
        Some(ThinkingLevel::Medium) => 4_096,
        Some(ThinkingLevel::High) => 8_192,
        Some(ThinkingLevel::Off) | None => return None,
    };
    Some(AnthropicThinkingConfig {
        r#type: "enabled".into(),
        budget_tokens: budget,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnthropicThinkingConfig {
    pub r#type: String,
    pub budget_tokens: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::{
        Message,
        MessageContent,
        Role,
    };

    // Scenario: prompt cache is enabled for Anthropic encode options.
    // Expected: system blocks include ephemeral cache_control metadata.
    // Invariant: thinking and tools remain in the wire body, not ModelRequest secrets.
    #[test]
    fn encode_request_adds_prompt_cache_control() {
        let request = ModelRequest {
            model: "claude".into(),
            system: "sys".into(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 64,
            thinking_level: Some(ThinkingLevel::Low),
            session_id: None,
            previous_response_id: None,
        };
        let body = encode_request(&request, EncodeOptions { prompt_cache: true }).expect("encode");
        assert!(body.stream);
        let system = body.system.expect("system");
        assert!(system[0].cache_control.is_some());
        assert!(body.thinking.is_some());
    }
}
