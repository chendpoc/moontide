use std::pin::Pin;

use futures::Stream;

use crate::llm::protocol::{
    LlmError, ModelRequest, StopReason, StreamDelta, Usage,
};
use crate::llm::LLMProvider;

/// Test double: returns a fixed delta sequence.
pub struct MockProvider {
    deltas: Vec<Result<StreamDelta, LlmError>>,
}

impl MockProvider {
    pub fn new(deltas: Vec<Result<StreamDelta, LlmError>>) -> Self {
        Self { deltas }
    }

    pub fn text_then_end(text: &str) -> Self {
        Self::new(vec![
            Ok(StreamDelta::TextDelta {
                text: text.to_string(),
            }),
            Ok(StreamDelta::MessageEnd {
                stop_reason: StopReason::EndTurn,
                usage: Some(Usage {
                    input_tokens: 1,
                    output_tokens: 1,
                }),
            }),
        ])
    }
}

impl LLMProvider for MockProvider {
    fn stream(
        &self,
        _request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<StreamDelta, LlmError>> + Send + '_>> {
        let deltas = self.deltas.clone();
        Box::pin(futures::stream::iter(deltas))
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::super::protocol::{
        ContentBlock, Message, MessageContent, ModelRequest, Role, StopReason, StreamDelta,
    };
    use serde_json::json;

    #[test]
    fn content_block_round_trip() {
        let block = ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: json!({"path": "a.rs"}),
        };
        let json = serde_json::to_string(&block).expect("serialize");
        let back: ContentBlock = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(block, back);
    }

    #[test]
    fn model_request_round_trip() {
        let request = ModelRequest {
            model: "deepseek-v4-pro".into(),
            system: "You are helpful.".into(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 1024,
            thinking_level: None,
            session_id: None,
        };
        let json = serde_json::to_string(&request).expect("serialize");
        let back: ModelRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(request.model, back.model);
        assert_eq!(request.messages.len(), 1);
    }

    #[test]
    fn stream_delta_message_end_round_trip() {
        let delta = StreamDelta::MessageEnd {
            stop_reason: StopReason::ToolUse,
            usage: None,
        };
        let json = serde_json::to_string(&delta).expect("serialize");
        let back: StreamDelta = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(delta, back);
    }
}

#[cfg(test)]
mod provider_tests {
    use futures::StreamExt;

    use super::{MockProvider, *};
    use crate::llm::protocol::{ContentBlock, Message, MessageContent, ModelRequest, Role, StopReason};
    use crate::llm::{complete, StreamDelta};

    fn sample_request() -> ModelRequest {
        ModelRequest {
            model: "mock".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("ping".into()),
            }],
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
        }
    }

    #[tokio::test]
    async fn mock_provider_stream_ends_with_message_end() {
        let provider = MockProvider::text_then_end("hello");
        let mut stream = provider.stream(sample_request());
        let mut last = None;
        while let Some(item) = stream.next().await {
            last = Some(item.expect("delta"));
        }
        match last {
            Some(StreamDelta::MessageEnd { stop_reason, .. }) => {
                assert_eq!(stop_reason, StopReason::EndTurn);
            }
            other => panic!("expected MessageEnd last, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn complete_collects_text_delta() {
        let provider = MockProvider::text_then_end("hello");
        let response = complete(&provider, sample_request())
            .await
            .expect("complete");
        assert_eq!(
            response.content,
            vec![ContentBlock::Text {
                text: "hello".into()
            }]
        );
        assert_eq!(response.stop_reason, StopReason::EndTurn);
        assert_eq!(response.model.as_deref(), Some("mock"));
    }
}
