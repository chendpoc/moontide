use std::pin::Pin;

use futures::Stream;

use crate::llm::protocol::{LlmError, ModelRequest, ModelStreamEvent, RequestFailureKind};
use crate::llm::LLMProvider;

/// Stub adapter — constructible via [`super::super::build_provider`], not yet wired to HTTP.
pub struct AnthropicMessagesAdapter {
    _base_url: String,
    _api_key: String,
}

impl AnthropicMessagesAdapter {
    pub fn new(base_url: String, api_key: String) -> Self {
        Self {
            _base_url: base_url,
            _api_key: api_key,
        }
    }
}

impl LLMProvider for AnthropicMessagesAdapter {
    fn stream(
        &self,
        _request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        Box::pin(futures::stream::once(async {
            Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: "AnthropicMessages adapter is not implemented".into(),
            })
        }))
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;

    use super::*;
    use crate::llm::protocol::{Message, MessageContent, Role};

    fn sample_request() -> ModelRequest {
        ModelRequest {
            model: "claude".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
        }
    }

    // Scenario: the declared but unimplemented Anthropic adapter receives a model request.
    // Expected: its stream returns an explicit unrecoverable error.
    // Invariant: constructing the stub never implies HTTP support exists.
    #[tokio::test]
    async fn stub_returns_unimplemented_error() {
        let adapter = AnthropicMessagesAdapter::new("https://api.anthropic.com".into(), "k".into());
        let item = adapter.stream(sample_request()).next().await;
        assert!(item.unwrap().is_err());
    }
}
