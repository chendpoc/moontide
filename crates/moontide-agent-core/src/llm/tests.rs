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

/// README §11 stream invariants — shared by invariant tests and future conformance gate.
#[cfg(test)]
pub(crate) fn assert_stream_invariants(deltas: &[StreamDelta]) {
    use std::collections::HashSet;

    let message_ends: usize = deltas
        .iter()
        .filter(|d| matches!(d, StreamDelta::MessageEnd { .. }))
        .count();
    assert_eq!(
        message_ends, 1,
        "success stream must contain exactly one MessageEnd"
    );
    assert!(
        matches!(deltas.last(), Some(StreamDelta::MessageEnd { .. })),
        "MessageEnd must be the final delta"
    );

    let mut open_tools = HashSet::new();
    for delta in deltas {
        match delta {
            StreamDelta::ToolUseStart { id, .. } => {
                assert!(
                    open_tools.insert(id.clone()),
                    "duplicate ToolUseStart for {id}"
                );
            }
            StreamDelta::ToolUseDelta { id, .. } => {
                assert!(
                    open_tools.contains(id),
                    "ToolUseDelta without ToolUseStart for {id}"
                );
            }
            StreamDelta::ToolUseEnd { id } => {
                assert!(
                    open_tools.remove(id),
                    "ToolUseEnd without ToolUseStart for {id}"
                );
            }
            _ => {}
        }
    }
    assert!(
        open_tools.is_empty(),
        "unclosed tool streams: {open_tools:?}"
    );
}

#[cfg(test)]
mod invariant_tests {
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::{assert_stream_invariants, MockProvider, *};
    use crate::llm::adapter::{build_provider, AdapterConfig, AdapterFamily};
    use crate::llm::adapter::openai_chat::OpenAiChatAdapter;
    use crate::llm::normalize::common::validate_request;
    use crate::llm::protocol::{Message, MessageContent, ModelRequest, Role, StopReason, StreamDelta};

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

    async fn collect_deltas(
        provider: &dyn LLMProvider,
        request: ModelRequest,
    ) -> Vec<StreamDelta> {
        let mut stream = provider.stream(request);
        let mut out = Vec::new();
        while let Some(item) = stream.next().await {
            out.push(item.expect("stream item"));
        }
        out
    }

    #[test]
    fn model_request_messages_must_not_be_empty() {
        let request = ModelRequest {
            model: "m".into(),
            system: String::new(),
            messages: vec![],
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
        };
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn build_provider_covers_every_adapter_family_variant() {
        let config = AdapterConfig {
            base_url: "https://example.com".into(),
            api_key: "k".into(),
        };
        let families = [
            AdapterFamily::OpenAiChatCompletions,
            AdapterFamily::AnthropicMessages,
        ];
        for family in families {
            assert!(
                build_provider(family, config.clone()).is_ok(),
                "build_provider failed for {family:?}"
            );
        }
    }

    #[tokio::test]
    async fn mock_text_stream_invariants() {
        let provider = MockProvider::text_then_end("hello");
        let deltas = collect_deltas(&provider, sample_request()).await;
        assert_stream_invariants(&deltas);
    }

    #[tokio::test]
    async fn mock_tool_sequence_invariants() {
        let provider = MockProvider::new(vec![
            Ok(StreamDelta::ToolUseStart {
                id: "call_1".into(),
                name: "grep".into(),
            }),
            Ok(StreamDelta::ToolUseDelta {
                id: "call_1".into(),
                input_json_delta: "{\"pattern\":\"x\"}".into(),
            }),
            Ok(StreamDelta::ToolUseEnd {
                id: "call_1".into(),
            }),
            Ok(StreamDelta::MessageEnd {
                stop_reason: StopReason::ToolUse,
                usage: None,
            }),
        ]);
        let deltas = collect_deltas(&provider, sample_request()).await;
        assert_stream_invariants(&deltas);
    }

    #[tokio::test]
    async fn mock_thinking_and_text_invariants() {
        let provider = MockProvider::new(vec![
            Ok(StreamDelta::ThinkingDelta {
                thinking: "plan".into(),
            }),
            Ok(StreamDelta::TextDelta {
                text: "done".into(),
            }),
            Ok(StreamDelta::MessageEnd {
                stop_reason: StopReason::EndTurn,
                usage: None,
            }),
        ]);
        let deltas = collect_deltas(&provider, sample_request()).await;
        assert_stream_invariants(&deltas);
    }

    #[tokio::test]
    async fn openai_adapter_mock_http_invariants() {
        const SSE: &str = "\
data: {\"choices\":[{\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}

data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}

data: [DONE]
";

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE),
            )
            .mount(&server)
            .await;

        let adapter = OpenAiChatAdapter::new(AdapterConfig {
            base_url: server.uri(),
            api_key: "test".into(),
        })
        .expect("adapter");

        let request = ModelRequest {
            model: "deepseek-chat".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("ping".into()),
            }],
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
        };

        let deltas = collect_deltas(&adapter, request).await;
        assert_stream_invariants(&deltas);
    }

    #[test]
    fn assert_stream_invariants_catches_duplicate_message_end() {
        let deltas = vec![
            StreamDelta::TextDelta {
                text: "a".into(),
            },
            StreamDelta::MessageEnd {
                stop_reason: StopReason::EndTurn,
                usage: None,
            },
            StreamDelta::MessageEnd {
                stop_reason: StopReason::EndTurn,
                usage: None,
            },
        ];
        let result = std::panic::catch_unwind(|| assert_stream_invariants(&deltas));
        assert!(result.is_err());
    }

    #[test]
    fn assert_stream_invariants_catches_tool_delta_without_start() {
        let deltas = vec![
            StreamDelta::ToolUseDelta {
                id: "x".into(),
                input_json_delta: "{}".into(),
            },
            StreamDelta::MessageEnd {
                stop_reason: StopReason::ToolUse,
                usage: None,
            },
        ];
        let result = std::panic::catch_unwind(|| assert_stream_invariants(&deltas));
        assert!(result.is_err());
    }
}
