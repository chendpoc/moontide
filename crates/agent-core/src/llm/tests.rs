use std::pin::Pin;

use futures::Stream;

use crate::llm::protocol::{LlmError, ModelRequest, ModelStreamEvent, StopReason, Usage};
use crate::llm::LLMProvider;

/// Test double: returns a fixed event sequence.
pub struct MockProvider {
    events: Vec<Result<ModelStreamEvent, LlmError>>,
}

impl MockProvider {
    pub fn new(events: Vec<Result<ModelStreamEvent, LlmError>>) -> Self {
        Self { events }
    }

    pub fn text_then_end(text: &str) -> Self {
        Self::new(vec![
            Ok(ModelStreamEvent::TextPart {
                block_index: 0,
                text: text.to_string(),
            }),
            Ok(ModelStreamEvent::Finished {
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
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        let events = self.events.clone();
        Box::pin(futures::stream::iter(events))
    }
}

/// Serde round-trips for protocol types.
#[cfg(test)]
mod protocol_tests {
    use super::super::protocol::{
        ContentBlock, Message, MessageContent, ModelRequest, ModelStreamEvent, Role, StopReason,
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
    fn model_stream_event_finished_round_trip() {
        let event = ModelStreamEvent::Finished {
            stop_reason: StopReason::ToolUse,
            usage: None,
        };
        let json = serde_json::to_string(&event).expect("serialize");
        let back: ModelStreamEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(event, back);
    }
}

/// `LLMProvider` port and `run_model_call` / `complete` against `MockProvider`.
#[cfg(test)]
mod provider_tests {
    use futures::StreamExt;

    use super::{MockProvider, *};
    use crate::llm::protocol::{
        ContentBlock, Message, MessageContent, ModelRequest, ModelStreamEvent, RequestFailureKind,
        Role, StopReason,
    };
    use crate::llm::{complete, run_model_call_with_updates, ModelResponseSnapshot};

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
    async fn mock_provider_stream_ends_with_finished() {
        let provider = MockProvider::text_then_end("hello");
        let mut stream = provider.stream(sample_request());
        let mut last = None;
        while let Some(item) = stream.next().await {
            last = Some(item.expect("event"));
        }
        match last {
            Some(ModelStreamEvent::Finished { stop_reason, .. }) => {
                assert_eq!(stop_reason, StopReason::EndTurn);
            }
            other => panic!("expected Finished last, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn complete_collects_text_part() {
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

    #[tokio::test]
    async fn complete_errors_when_stream_omits_finished() {
        let provider = MockProvider::new(vec![Ok(ModelStreamEvent::TextPart {
            block_index: 0,
            text: "hello".into(),
        })]);
        let err = complete(&provider, sample_request())
            .await
            .expect_err("missing Finished");
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn run_model_call_with_updates_invokes_callback_per_event() {
        let provider = MockProvider::text_then_end("hi");
        let mut updates = Vec::<ModelResponseSnapshot>::new();
        run_model_call_with_updates(&provider, sample_request(), |snap| updates.push(snap))
            .await
            .expect("run");
        assert_eq!(updates.len(), 2);
        assert!(updates[0].pending.is_some());
        assert_eq!(updates[1].stop_reason, Some(StopReason::EndTurn));
    }

    // Scenario: an OpenAI-compatible provider streams two tool calls in one assistant response.
    // Expected: both calls fold into the final response in their provider order.
    // Invariant: a second ToolUseStarted is a parallel call, not a malformed nested call.
    #[tokio::test]
    async fn complete_accepts_parallel_tool_calls() {
        let provider = MockProvider::new(vec![
            Ok(ModelStreamEvent::ToolUseStarted {
                id: "call_00".into(),
                name: "read".into(),
            }),
            Ok(ModelStreamEvent::ToolUsePart {
                id: "call_00".into(),
                input_json: r#"{"path":"README.md"}"#.into(),
            }),
            Ok(ModelStreamEvent::ToolUseStarted {
                id: "call_01".into(),
                name: "grep".into(),
            }),
            Ok(ModelStreamEvent::ToolUsePart {
                id: "call_01".into(),
                input_json: r#"{"pattern":"Agent"}"#.into(),
            }),
            Ok(ModelStreamEvent::ToolUseFinished {
                id: "call_00".into(),
                name: "read".into(),
                input: serde_json::json!({"path": "README.md"}),
            }),
            Ok(ModelStreamEvent::ToolUseFinished {
                id: "call_01".into(),
                name: "grep".into(),
                input: serde_json::json!({"pattern": "Agent"}),
            }),
            Ok(ModelStreamEvent::Finished {
                stop_reason: StopReason::ToolUse,
                usage: None,
            }),
        ]);

        let response = complete(&provider, sample_request())
            .await
            .expect("parallel tool calls should fold");

        assert_eq!(
            response.content,
            vec![
                ContentBlock::ToolUse {
                    id: "call_00".into(),
                    name: "read".into(),
                    input: serde_json::json!({"path": "README.md"}),
                },
                ContentBlock::ToolUse {
                    id: "call_01".into(),
                    name: "grep".into(),
                    input: serde_json::json!({"pattern": "Agent"}),
                },
            ]
        );
    }
}

/// README §11 stream invariants.
#[cfg(test)]
pub(crate) fn assert_stream_invariants(events: &[ModelStreamEvent]) {
    use std::collections::HashSet;

    let finished_count = events
        .iter()
        .filter(|e| matches!(e, ModelStreamEvent::Finished { .. }))
        .count();
    assert_eq!(
        finished_count, 1,
        "success stream must contain exactly one Finished"
    );
    assert!(
        matches!(events.last(), Some(ModelStreamEvent::Finished { .. })),
        "Finished must be the final event"
    );

    let mut open_tools = HashSet::new();
    for event in events {
        match event {
            ModelStreamEvent::ToolUseStarted { id, .. } => {
                assert!(
                    open_tools.insert(id.clone()),
                    "duplicate ToolUseStarted for {id}"
                );
            }
            ModelStreamEvent::ToolUsePart { id, .. } => {
                assert!(
                    open_tools.contains(id),
                    "ToolUsePart without ToolUseStarted for {id}"
                );
            }
            ModelStreamEvent::ToolUseFinished { id, .. } => {
                assert!(
                    open_tools.remove(id),
                    "ToolUseFinished without ToolUseStarted for {id}"
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

/// README §11: request validation, adapter factory coverage, stream shape, helper negatives.
#[cfg(test)]
mod invariant_tests {
    use futures::StreamExt;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::{assert_stream_invariants, MockProvider, *};
    use crate::llm::adapter::openai_chat::OpenAiChatAdapter;
    use crate::llm::adapter::{build_provider, AdapterConfig};
    use crate::llm::normalize::{common::validate_request, openai_chat::OpenAiChatOptions};
    use crate::llm::protocol::{
        Message, MessageContent, ModelRequest, ModelStreamEvent, Role, StopReason,
    };

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

    async fn collect_events(
        provider: &dyn LLMProvider,
        request: ModelRequest,
    ) -> Vec<ModelStreamEvent> {
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

    // Scenario: the factory receives each adapter-specific configuration variant.
    // Expected: every declared family constructs successfully.
    // Invariant: family selection is encoded by AdapterConfig rather than parallel arguments.
    #[test]
    fn build_provider_covers_every_adapter_family_variant() {
        let configs = [
            AdapterConfig::OpenAiChat {
                base_url: "https://example.com".into(),
                api_key: "k".into(),
                options: OpenAiChatOptions::default(),
            },
            AdapterConfig::AnthropicMessages {
                base_url: "https://example.com".into(),
                api_key: "k".into(),
            },
        ];
        for config in configs {
            assert!(build_provider(config).is_ok());
        }
    }

    #[tokio::test]
    async fn mock_text_stream_invariants() {
        let provider = MockProvider::text_then_end("hello");
        let events = collect_events(&provider, sample_request()).await;
        assert_stream_invariants(&events);
    }

    #[tokio::test]
    async fn mock_tool_sequence_invariants() {
        let provider = MockProvider::new(vec![
            Ok(ModelStreamEvent::ToolUseStarted {
                id: "call_1".into(),
                name: "grep".into(),
            }),
            Ok(ModelStreamEvent::ToolUsePart {
                id: "call_1".into(),
                input_json: "{\"pattern\":\"x\"}".into(),
            }),
            Ok(ModelStreamEvent::ToolUseFinished {
                id: "call_1".into(),
                name: "grep".into(),
                input: json!({"pattern": "x"}),
            }),
            Ok(ModelStreamEvent::Finished {
                stop_reason: StopReason::ToolUse,
                usage: None,
            }),
        ]);
        let events = collect_events(&provider, sample_request()).await;
        assert_stream_invariants(&events);
    }

    #[tokio::test]
    async fn mock_thinking_and_text_invariants() {
        let provider = MockProvider::new(vec![
            Ok(ModelStreamEvent::ThinkingPart {
                block_index: 0,
                thinking: "plan".into(),
            }),
            Ok(ModelStreamEvent::TextPart {
                block_index: 1,
                text: "done".into(),
            }),
            Ok(ModelStreamEvent::Finished {
                stop_reason: StopReason::EndTurn,
                usage: None,
            }),
        ]);
        let events = collect_events(&provider, sample_request()).await;
        assert_stream_invariants(&events);
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

        let adapter =
            OpenAiChatAdapter::new(server.uri(), "test".into(), OpenAiChatOptions::default())
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

        let events = collect_events(&adapter, request).await;
        assert_stream_invariants(&events);
    }

    #[test]
    fn assert_stream_invariants_catches_duplicate_finished() {
        let events = vec![
            ModelStreamEvent::TextPart {
                block_index: 0,
                text: "a".into(),
            },
            ModelStreamEvent::Finished {
                stop_reason: StopReason::EndTurn,
                usage: None,
            },
            ModelStreamEvent::Finished {
                stop_reason: StopReason::EndTurn,
                usage: None,
            },
        ];
        let result = std::panic::catch_unwind(|| assert_stream_invariants(&events));
        assert!(result.is_err());
    }

    #[test]
    fn assert_stream_invariants_catches_tool_part_without_start() {
        let events = vec![
            ModelStreamEvent::ToolUsePart {
                id: "x".into(),
                input_json: "{}".into(),
            },
            ModelStreamEvent::Finished {
                stop_reason: StopReason::ToolUse,
                usage: None,
            },
        ];
        let result = std::panic::catch_unwind(|| assert_stream_invariants(&events));
        assert!(result.is_err());
    }
}

/// README §12: HTTP 4xx/5xx, truncated SSE, invalid JSON → `LlmError::RequestFailed`.
#[cfg(test)]
mod error_tests {
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::llm::adapter::openai_chat::OpenAiChatAdapter;
    use crate::llm::normalize::openai_chat::OpenAiChatOptions;
    use crate::llm::protocol::{
        LlmError, Message, MessageContent, ModelRequest, RequestFailureKind, Role,
    };
    use crate::llm::LLMProvider;

    fn sample_request() -> ModelRequest {
        ModelRequest {
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
        }
    }

    async fn adapter_against(
        status: u16,
        body: &str,
        content_type: &str,
    ) -> (MockServer, OpenAiChatAdapter) {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(
                ResponseTemplate::new(status)
                    .insert_header("content-type", content_type)
                    .set_body_string(body.to_string()),
            )
            .mount(&server)
            .await;
        let adapter =
            OpenAiChatAdapter::new(server.uri(), "test".into(), OpenAiChatOptions::default())
                .expect("adapter");
        (server, adapter)
    }

    async fn first_stream_error(adapter: &OpenAiChatAdapter) -> LlmError {
        let mut stream = adapter.stream(sample_request());
        while let Some(item) = stream.next().await {
            if let Err(err) = item {
                return err;
            }
        }
        panic!("expected LlmError on stream, stream ended successfully");
    }

    #[tokio::test]
    async fn openai_adapter_http_4xx_is_unrecoverable() {
        let (_server, adapter) = adapter_against(400, "bad request", "text/plain").await;
        let err = first_stream_error(&adapter).await;
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn openai_adapter_http_5xx_is_recoverable() {
        let (_server, adapter) = adapter_against(503, "unavailable", "text/plain").await;
        let err = first_stream_error(&adapter).await;
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Recoverable,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn openai_adapter_done_without_finish_is_recoverable() {
        const DONE_ONLY: &str = "\
data: {\"choices\":[{\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}

data: [DONE]
";
        let (_server, adapter) = adapter_against(200, DONE_ONLY, "text/event-stream").await;
        let err = first_stream_error(&adapter).await;
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Recoverable,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn openai_adapter_truncated_sse_is_recoverable() {
        const TRUNCATED: &str = "\
data: {\"choices\":[{\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}
";
        let (_server, adapter) = adapter_against(200, TRUNCATED, "text/event-stream").await;
        let err = first_stream_error(&adapter).await;
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Recoverable,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn openai_adapter_invalid_sse_json_is_unrecoverable() {
        const INVALID: &str = "\
data: not-json

data: [DONE]
";
        let (_server, adapter) = adapter_against(200, INVALID, "text/event-stream").await;
        let err = first_stream_error(&adapter).await;
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            }
        ));
    }
}
