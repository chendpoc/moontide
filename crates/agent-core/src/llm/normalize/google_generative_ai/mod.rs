pub mod stream;
pub mod tool;

pub use stream::{
    GeminiStreamChunk,
    StreamDecoder,
};
use tool::{
    GeminiRequestBody,
    encode_contents,
    encode_tools,
};

use super::common::validate_request;
use crate::llm::protocol::{
    LlmError,
    ModelRequest,
};

pub fn encode_request(request: &ModelRequest) -> Result<GeminiRequestBody, LlmError> {
    validate_request(request)?;

    let mut contents = encode_contents(&request.messages)?;
    if !request.system.is_empty() {
        contents.insert(
            0,
            tool::GeminiContent {
                role: "user".into(),
                parts: vec![tool::GeminiPart::Text {
                    text: format!("System instructions:\n{}", request.system),
                }],
            },
        );
    }

    let tools = if request.tools.is_empty() {
        None
    } else {
        Some(encode_tools(&request.tools))
    };

    Ok(GeminiRequestBody {
        contents,
        generation_config: Some(tool::GeminiGenerationConfig {
            max_output_tokens: request.max_tokens,
        }),
        tools,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::{
        Message,
        MessageContent,
        Role,
    };

    // Scenario: a basic Gemini request with user text is encoded for streamGenerateContent.
    // Expected: contents carry the user role and generation config includes max tokens.
    // Invariant: system instructions are injected as an initial user content block.
    #[test]
    fn encode_request_maps_user_message_and_system() {
        let request = ModelRequest {
            model: "gemini-2.0-flash".into(),
            system: "be helpful".into(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 128,
            thinking_level: None,
            session_id: None,
            previous_response_id: None,
        };
        let body = encode_request(&request).expect("encode");
        assert_eq!(body.contents.len(), 2);
        assert_eq!(
            body.generation_config.expect("config").max_output_tokens,
            128
        );
    }
}
