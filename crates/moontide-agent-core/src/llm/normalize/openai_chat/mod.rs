pub mod stream;
pub mod thinking;
pub mod tool;

use crate::llm::protocol::{LlmError, ModelRequest, ToolSchema};

use super::common::validate_request;
use tool::{
    OpenAiChatMessage, OpenAiChatRequestBody, OpenAiFunctionDefinition, OpenAiToolDefinition,
};

pub use stream::{ChatCompletionChunk, StreamDecoder};
pub use tool::encode_messages;

/// MoonTide request → OpenAI Chat Completions JSON body (no HTTP).
pub fn encode_request(request: &ModelRequest) -> Result<OpenAiChatRequestBody, LlmError> {
    validate_request(request)?;

    let mut messages = Vec::with_capacity(request.messages.len() + 1);
    if !request.system.is_empty() {
        messages.push(OpenAiChatMessage {
            role: "system".into(),
            content: Some(request.system.clone()),
            reasoning_content: None,
            tool_calls: None,
            tool_call_id: None,
        });
    }
    messages.extend(encode_messages(&request.messages)?);

    let tools = if request.tools.is_empty() {
        None
    } else {
        Some(encode_tools(&request.tools))
    };

    Ok(OpenAiChatRequestBody {
        model: request.model.clone(),
        messages,
        tools,
        max_tokens: request.max_tokens,
        stream: true,
    })
}

fn encode_tools(tools: &[ToolSchema]) -> Vec<OpenAiToolDefinition> {
    tools
        .iter()
        .map(|tool| OpenAiToolDefinition {
            r#type: "function".into(),
            function: OpenAiFunctionDefinition {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: tool.input_schema.clone(),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::{Message, MessageContent, Role};

    #[test]
    fn encode_request_includes_system_and_stream_flag() {
        let request = ModelRequest {
            model: "deepseek-chat".into(),
            system: "sys".into(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 128,
            thinking_level: None,
            session_id: None,
        };
        let body = encode_request(&request).expect("encode");
        assert!(body.stream);
        assert_eq!(body.messages[0].role, "system");
        assert_eq!(body.messages.len(), 2);
    }
}
