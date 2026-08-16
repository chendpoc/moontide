use std::pin::Pin;

use futures::Stream;

use crate::llm::adapter::AdapterConfig;
use crate::llm::protocol::{LlmError, ModelRequest, ModelStreamEvent, RequestFailureKind};
use crate::llm::LLMProvider;

/// Stub adapter — constructible via [`super::super::build_provider`], not yet wired to HTTP.
pub struct AnthropicMessagesAdapter {
    _config: AdapterConfig,
}

impl AnthropicMessagesAdapter {
    pub fn new(config: AdapterConfig) -> Self {
        Self { _config: config }
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

    #[tokio::test]
    async fn stub_returns_unimplemented_error() {
        let adapter = AnthropicMessagesAdapter::new(AdapterConfig {
            base_url: "https://api.anthropic.com".into(),
            api_key: "k".into(),
        });
        let item = adapter.stream(sample_request()).next().await;
        assert!(item.unwrap().is_err());
    }
}
