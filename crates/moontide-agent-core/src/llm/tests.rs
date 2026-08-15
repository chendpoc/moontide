use std::pin::Pin;

use futures::Stream;

use crate::llm::protocol::{LlmError, ModelRequest, StopReason, StreamDelta, Usage};
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

/// Serde round-trips for protocol types (`ContentBlock`, `ModelRequest`, `StreamDelta`).
/// Guards tagged-enum JSON (`type` + snake_case) so adapters can persist / replay events.
#[cfg(test)]
mod protocol_tests {
    use super::super::protocol::{
        ContentBlock, Message, MessageContent, ModelRequest, Role, StopReason, StreamDelta,
    };
    use serde_json::json;

    /// `ContentBlock::ToolUse` (tag + nested JSON `input`) survives serialize → deserialize.
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

    /// `ModelRequest` including `Message { Role::User, MessageContent::Text }` round-trips.
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

    /// `StreamDelta::MessageEnd` with `StopReason::ToolUse` and `usage: None` round-trips.
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

/// `LLMProvider` port and `complete()` helper against `MockProvider`.
#[cfg(test)]
mod provider_tests {
    use futures::StreamExt;

    use super::{MockProvider, *};
    use crate::llm::protocol::{
        ContentBlock, Message, MessageContent, ModelRequest, RequestFailureKind, Role, StopReason,
    };
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

    /// `text_then_end` stream's last item is `MessageEnd { stop_reason: EndTurn }`.
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

    /// `complete()` folds `TextDelta`s into `ContentBlock::Text` and copies model / stop_reason.
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

    /// Clean stream end without `MessageEnd` → `RequestFailed` Unrecoverable (protocol, not transport).
    #[tokio::test]
    async fn complete_errors_when_stream_omits_message_end() {
        let provider = MockProvider::new(vec![Ok(StreamDelta::TextDelta {
            text: "hello".into(),
        })]);
        let err = complete(&provider, sample_request())
            .await
            .expect_err("missing MessageEnd");
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            }
        ));
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

/// README §11: request validation, adapter factory coverage, stream shape, helper negatives.
#[cfg(test)]
mod invariant_tests {
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::{assert_stream_invariants, MockProvider, *};
    use crate::llm::adapter::openai_chat::OpenAiChatAdapter;
    use crate::llm::adapter::{build_provider, AdapterConfig, AdapterFamily};
    use crate::llm::normalize::common::validate_request;
    use crate::llm::protocol::{
        Message, MessageContent, ModelRequest, Role, StopReason, StreamDelta,
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

    async fn collect_deltas(provider: &dyn LLMProvider, request: ModelRequest) -> Vec<StreamDelta> {
        let mut stream = provider.stream(request);
        let mut out = Vec::new();
        while let Some(item) = stream.next().await {
            out.push(item.expect("stream item"));
        }
        out
    }

    /// §11.3: `validate_request` rejects empty `messages` (`system` may be empty).
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

    /// §15: `build_provider` constructs every `AdapterFamily` variant (stub counts).
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

    /// Text-only success path: exactly one `MessageEnd`, and it is last.
    #[tokio::test]
    async fn mock_text_stream_invariants() {
        let provider = MockProvider::text_then_end("hello");
        let deltas = collect_deltas(&provider, sample_request()).await;
        assert_stream_invariants(&deltas);
    }

    /// Tool pairing: `Start` → `Delta` → `End` for the same `id`, then `MessageEnd { ToolUse }`.
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

    /// `ThinkingDelta` + `TextDelta` before a single terminal `MessageEnd`.
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

    /// OpenAI Chat adapter: mock SSE (`content` + `finish_reason: stop`) decodes to a valid stream.
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

    /// Helper negative: two `MessageEnd`s must panic (exactly-one rule).
    #[test]
    fn assert_stream_invariants_catches_duplicate_message_end() {
        let deltas = vec![
            StreamDelta::TextDelta { text: "a".into() },
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

    /// Helper negative: `ToolUseDelta` without a prior `ToolUseStart` must panic.
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

/// README §12: HTTP 4xx/5xx, truncated SSE, invalid JSON → `LlmError::RequestFailed`.
#[cfg(test)]
mod error_tests {
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::llm::adapter::openai_chat::OpenAiChatAdapter;
    use crate::llm::adapter::AdapterConfig;
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
        let adapter = OpenAiChatAdapter::new(AdapterConfig {
            base_url: server.uri(),
            api_key: "test".into(),
        })
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

    /// HTTP 4xx → `RequestFailed` Unrecoverable (client error, do not retry as-is).
    #[tokio::test]
    async fn openai_adapter_http_4xx_is_unrecoverable() {
        let (_server, adapter) = adapter_against(400, "bad request", "text/plain").await;
        let err = first_stream_error(&adapter).await;
        assert!(
            matches!(
                err,
                LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    ..
                }
            ),
            "got {err:?}"
        );
    }

    /// HTTP 5xx → `RequestFailed` Recoverable (server / transient).
    #[tokio::test]
    async fn openai_adapter_http_5xx_is_recoverable() {
        let (_server, adapter) = adapter_against(503, "unavailable", "text/plain").await;
        let err = first_stream_error(&adapter).await;
        assert!(
            matches!(
                err,
                LlmError::RequestFailed {
                    kind: RequestFailureKind::Recoverable,
                    ..
                }
            ),
            "got {err:?}"
        );
    }

    /// `[DONE]` is ignored; without `finish_reason` the stream is incomplete → Recoverable.
    #[tokio::test]
    async fn openai_adapter_done_without_finish_is_recoverable() {
        const DONE_ONLY: &str = "\
data: {\"choices\":[{\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}

data: [DONE]
";
        let (_server, adapter) = adapter_against(200, DONE_ONLY, "text/event-stream").await;
        let err = first_stream_error(&adapter).await;
        assert!(
            matches!(
                err,
                LlmError::RequestFailed {
                    kind: RequestFailureKind::Recoverable,
                    ..
                }
            ),
            "got {err:?}"
        );
    }

    /// HTTP 200 SSE cut off after a text delta (no `finish_reason`, no `[DONE]`) → Recoverable.
    #[tokio::test]
    async fn openai_adapter_truncated_sse_is_recoverable() {
        const TRUNCATED: &str = "\
data: {\"choices\":[{\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}
";
        let (_server, adapter) = adapter_against(200, TRUNCATED, "text/event-stream").await;
        let err = first_stream_error(&adapter).await;
        assert!(
            matches!(
                err,
                LlmError::RequestFailed {
                    kind: RequestFailureKind::Recoverable,
                    ..
                }
            ),
            "got {err:?}"
        );
    }

    /// HTTP 200 SSE with a non-JSON `data:` payload → Unrecoverable.
    #[tokio::test]
    async fn openai_adapter_invalid_sse_json_is_unrecoverable() {
        const INVALID: &str = "\
data: not-json

data: [DONE]
";
        let (_server, adapter) = adapter_against(200, INVALID, "text/event-stream").await;
        let err = first_stream_error(&adapter).await;
        assert!(
            matches!(
                err,
                LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    ..
                }
            ),
            "got {err:?}"
        );
    }
}
