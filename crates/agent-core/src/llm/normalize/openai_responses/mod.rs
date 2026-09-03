pub mod stream;
pub mod tool;

use serde::Deserialize;
use serde_json::Value;
pub use stream::{
    ResponsesDecodeConfig,
    StreamDecoder,
};
use tool::{
    OpenAiResponsesRequestBody,
    encode_input,
    encode_tools,
};

use super::common::validate_request;
use crate::llm::profile_config::WireProfileConfig;
use crate::llm::protocol::{
    LlmError,
    ModelRequest,
};

/// Encode options for the OpenAI Responses wire body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodeOptions {
    pub store_enabled: bool,
    pub previous_id_enabled: bool,
}

/// MoonTide request → OpenAI Responses JSON body (no HTTP).
pub fn encode_request(
    request: &ModelRequest,
    options: EncodeOptions,
) -> Result<OpenAiResponsesRequestBody, LlmError> {
    validate_request(request)?;

    let store = options.store_enabled.then_some(true);
    let previous_response_id = if options.previous_id_enabled {
        request.previous_response_id.clone()
    } else {
        None
    };

    let tools = if request.tools.is_empty() {
        None
    } else {
        Some(encode_tools(&request.tools))
    };

    Ok(OpenAiResponsesRequestBody {
        model: request.model.clone(),
        input: encode_input(request)?,
        stream: true,
        max_output_tokens: request.max_tokens,
        store,
        previous_response_id,
        tools,
    })
}

pub fn decode_config_from_wire(wire: &WireProfileConfig) -> ResponsesDecodeConfig {
    ResponsesDecodeConfig::from_wire(wire)
}

/// Parsed SSE event envelope (one `data:` line body).
#[derive(Debug, Clone, Deserialize)]
pub struct ResponsesStreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub delta: Option<String>,
    #[serde(default)]
    pub response: Option<ResponseObject>,
    #[serde(default)]
    pub item: Option<Value>,
    #[serde(default)]
    pub output_index: Option<u32>,
    #[serde(default)]
    pub item_id: Option<String>,
    #[serde(default)]
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseObject {
    pub id: Option<String>,
    pub status: Option<String>,
    pub usage: Option<ResponseUsage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResponseUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::{
        Message,
        MessageContent,
        Role,
    };

    // Scenario: store and previous_response_id flags gate optimized Responses fields.
    // Expected: enabled flags serialize store and carry prior response id from ModelRequest.
    // Invariant: disabled flags omit continuity fields even when ModelRequest carries them.
    #[test]
    fn encode_request_respects_store_and_previous_id_flags() {
        let request = ModelRequest {
            model: "gpt-4.1".into(),
            system: "sys".into(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 128,
            thinking_level: None,
            session_id: None,
            previous_response_id: Some("resp_prev".into()),
        };

        let body = encode_request(
            &request,
            EncodeOptions {
                store_enabled: true,
                previous_id_enabled: true,
            },
        )
        .expect("encode");
        assert!(body.stream);
        assert_eq!(body.store, Some(true));
        assert_eq!(body.previous_response_id.as_deref(), Some("resp_prev"));

        let canonical = encode_request(
            &request,
            EncodeOptions {
                store_enabled: false,
                previous_id_enabled: false,
            },
        )
        .expect("encode canonical");
        assert!(canonical.store.is_none());
        assert!(canonical.previous_response_id.is_none());
    }
}
