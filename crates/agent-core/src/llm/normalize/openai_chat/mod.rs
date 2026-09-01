pub mod stream;
pub mod thinking;
pub mod tool;

use crate::llm::protocol::{LlmError, ModelRequest, ToolSchema};

use super::common::validate_request;
use thinking::encode_thinking_extensions;
use tool::{
    OpenAiChatMessage, OpenAiChatRequestBody, OpenAiFunctionDefinition, OpenAiToolDefinition,
};

pub use stream::{ChatCompletionChunk, StreamDecoder};
pub use tool::encode_messages;

/// Provider-resolved OpenAI thinking wire extension.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OpenAiThinkingExtension {
    #[default]
    None,
    ChatTemplateKwargs,
}

/// Provider-resolved options for the OpenAI Chat Completions adapter.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OpenAiChatOptions {
    pub thinking_extension: OpenAiThinkingExtension,
}

/// MoonTide request → OpenAI Chat Completions JSON body (no HTTP).
pub fn encode_request(
    request: &ModelRequest,
    options: OpenAiChatOptions,
) -> Result<OpenAiChatRequestBody, LlmError> {
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
        chat_template_kwargs: encode_thinking_extensions(request, options.thinking_extension),
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
    use crate::llm::protocol::{Message, MessageContent, Role, ThinkingLevel};
    use tool::ChatTemplateKwargs;

    // Scenario: a request without provider-specific extensions contains system and user messages.
    // Expected: encoding enables streaming and omits chat_template_kwargs.
    // Invariant: default OpenAI options do not inject provider-specific wire fields.
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
        let body = encode_request(&request, OpenAiChatOptions::default()).expect("encode");
        assert!(body.stream);
        assert_eq!(body.messages[0].role, "system");
        assert_eq!(body.messages.len(), 2);
        assert!(body.chat_template_kwargs.is_none());
    }

    // Scenario: the resolved provider requests chat-template thinking and thinking is enabled.
    // Expected: encoding emits chat_template_kwargs.enable_thinking=true.
    // Invariant: the decision comes from explicit adapter options, not model identity.
    #[test]
    fn encode_request_adds_chat_template_kwargs_for_agnes_thinking() {
        let request = ModelRequest {
            model: "agnes-2.5-flash".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 128,
            thinking_level: Some(ThinkingLevel::Low),
            session_id: None,
        };
        let body = encode_request(
            &request,
            OpenAiChatOptions {
                thinking_extension: OpenAiThinkingExtension::ChatTemplateKwargs,
            },
        )
        .expect("encode");
        assert_eq!(
            body.chat_template_kwargs,
            Some(ChatTemplateKwargs {
                enable_thinking: true
            })
        );
    }
}
