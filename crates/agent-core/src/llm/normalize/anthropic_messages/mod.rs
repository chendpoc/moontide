use crate::llm::protocol::{LlmError, Message, ModelRequest};

use super::common::validate_request;

/// Wire body placeholder — Anthropic Messages shape aligns with MoonTide protocol for v1.
#[derive(Debug, Clone, PartialEq)]
pub struct AnthropicMessagesBody {
    pub model: String,
    pub system: String,
    pub messages: Vec<Message>,
    pub max_tokens: u32,
}

/// Identity encode for pass-through v1.
pub fn encode_request(request: &ModelRequest) -> Result<AnthropicMessagesBody, LlmError> {
    validate_request(request)?;
    Ok(AnthropicMessagesBody {
        model: request.model.clone(),
        system: request.system.clone(),
        messages: request.messages.clone(),
        max_tokens: request.max_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::{MessageContent, Role};

    #[test]
    fn encode_request_is_identity() {
        let request = ModelRequest {
            model: "claude".into(),
            system: "s".into(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("x".into()),
            }],
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
        };
        let body = encode_request(&request).expect("encode");
        assert_eq!(body.messages, request.messages);
    }
}
