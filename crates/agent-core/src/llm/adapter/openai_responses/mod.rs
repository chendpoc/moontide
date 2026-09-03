mod sse;

use std::pin::Pin;

use futures::{
    Stream,
    StreamExt,
};
use tokio::sync::mpsc;

use super::sse::{
    classify_http_status,
    stream_from_receiver,
    ByteLineBuffer,
};
use crate::llm::normalize::openai_responses::{
    decode_config_from_wire,
    encode_request,
    EncodeOptions,
    StreamDecoder,
};
use crate::llm::profile_config::WireProfileConfig;
use crate::llm::protocol::{
    LlmError,
    ModelRequest,
    ModelStreamEvent,
    RequestFailureKind,
};
use crate::llm::LLMProvider;

/// OpenAI Responses API adapter (HTTP + semantic SSE).
pub struct OpenAiResponsesAdapter {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    wire: WireProfileConfig,
    store_enabled: bool,
    previous_id_enabled: bool,
}

impl OpenAiResponsesAdapter {
    pub fn new(
        base_url: String,
        api_key: String,
        wire: WireProfileConfig,
        store_enabled: bool,
        previous_id_enabled: bool,
    ) -> Result<Self, LlmError> {
        if base_url.trim().is_empty() {
            return Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: "base_url must not be empty".into(),
            });
        }
        Ok(Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            wire,
            store_enabled,
            previous_id_enabled,
        })
    }

    fn responses_url(&self) -> String {
        format!("{}/responses", self.base_url)
    }
}

impl LLMProvider for OpenAiResponsesAdapter {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        let url = self.responses_url();
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let wire = self.wire.clone();
        let store_enabled = self.store_enabled;
        let previous_id_enabled = self.previous_id_enabled;

        let (tx, rx) = mpsc::channel::<Result<ModelStreamEvent, LlmError>>(64);

        tokio::spawn(async move {
            if let Err(err) = run_stream(
                client,
                url,
                api_key,
                wire,
                store_enabled,
                previous_id_enabled,
                request,
                tx.clone(),
            )
            .await
            {
                let _ = tx.send(Err(err)).await;
            }
        });

        Box::pin(stream_from_receiver(rx))
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_stream(
    client: reqwest::Client,
    url: String,
    api_key: String,
    wire: WireProfileConfig,
    store_enabled: bool,
    previous_id_enabled: bool,
    request: ModelRequest,
    tx: mpsc::Sender<Result<ModelStreamEvent, LlmError>>,
) -> Result<(), LlmError> {
    let body = encode_request(
        &request,
        EncodeOptions {
            store_enabled,
            previous_id_enabled,
        },
    )?;

    let response = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| LlmError::RequestFailed {
            kind: RequestFailureKind::Recoverable,
            message: format!("HTTP request failed: {e}"),
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(LlmError::RequestFailed {
            kind: classify_http_status(status.as_u16()),
            message: format!("HTTP {status}: {text}"),
        });
    }

    let decode_config = decode_config_from_wire(&wire);
    let mut decoder = StreamDecoder::with_config(decode_config);
    let mut lines = ByteLineBuffer::new();
    let mut byte_stream = response.bytes_stream();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| LlmError::RequestFailed {
            kind: RequestFailureKind::Recoverable,
            message: format!("SSE read failed: {e}"),
        })?;
        lines.push(&chunk);

        while let Some(line) = lines.next_line()? {
            if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
                continue;
            }
            let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(&line);
            if payload == "[DONE]" {
                continue;
            }
            let events = sse::decode_sse_payload(&mut decoder, payload)?;
            for event in events {
                if tx.send(Ok(event)).await.is_err() {
                    return Ok(());
                }
            }
        }
    }

    if decoder.has_emitted_message_end() {
        Ok(())
    } else {
        Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Recoverable,
            message: "SSE stream ended without Finished".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;
    use wiremock::matchers::{
        method,
        path,
    };
    use wiremock::{
        Mock,
        MockServer,
        ResponseTemplate,
    };

    use super::*;
    use crate::llm::protocol::{
        Message,
        MessageContent,
        ModelStreamEvent,
        Role,
        StopReason,
    };

    fn sample_request() -> ModelRequest {
        ModelRequest {
            model: "gpt-4.1".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("ping".into()),
            }],
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
            previous_response_id: None,
        }
    }

    const SSE_OK: &str = "\
data: {\"type\":\"response.output_text.delta\",\"delta\":\"pong\"}

data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_test\",\"status\":\"completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}

";

    // Scenario: a mock Responses endpoint emits text followed by response.completed.
    // Expected: the adapter exposes Finished with response_id and EndTurn semantics.
    // Invariant: semantic SSE events fold into canonical ModelStreamEvent sequence.
    #[tokio::test]
    async fn mock_http_stream_ends_with_finished_and_response_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE_OK),
            )
            .mount(&server)
            .await;

        let adapter = OpenAiResponsesAdapter::new(
            server.uri(),
            "test".into(),
            WireProfileConfig::default(),
            false,
            false,
        )
        .expect("adapter");

        let mut stream = adapter.stream(sample_request());
        let mut last = None;
        while let Some(item) = stream.next().await {
            last = Some(item.expect("event"));
        }
        match last {
            Some(ModelStreamEvent::Finished {
                stop_reason,
                response_id,
                ..
            }) => {
                assert_eq!(stop_reason, StopReason::EndTurn);
                assert_eq!(response_id.as_deref(), Some("resp_test"));
            }
            other => panic!("expected Finished, got {other:?}"),
        }
    }

    // Scenario: DeepSeek Responses wire uses reasoning_text.delta for thinking chunks.
    // Expected: the adapter maps reasoning deltas to ThinkingPart before Finished.
    // Invariant: wire decode config from profile drives event field selection.
    #[tokio::test]
    async fn deepseek_mock_http_stream_maps_reasoning_delta() {
        const SSE_DEEPSEEK: &str = "\
data: {\"type\":\"response.reasoning_text.delta\",\"delta\":\"trace\"}

data: {\"type\":\"response.output_text.delta\",\"delta\":\"pong\"}

data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_ds\",\"status\":\"completed\"}}

";

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE_DEEPSEEK),
            )
            .mount(&server)
            .await;

        let mut wire = WireProfileConfig::default();
        wire.decode.reasoning_delta_field = Some("reasoning_text".into());

        let adapter = OpenAiResponsesAdapter::new(server.uri(), "test".into(), wire, false, false)
            .expect("adapter");

        let mut stream = adapter.stream(sample_request());
        let mut saw_thinking = false;
        let mut last = None;
        while let Some(item) = stream.next().await {
            let event = item.expect("event");
            if matches!(event, ModelStreamEvent::ThinkingPart { .. }) {
                saw_thinking = true;
            }
            last = Some(event);
        }
        assert!(saw_thinking);
        assert!(matches!(
            last,
            Some(ModelStreamEvent::Finished {
                response_id: Some(id),
                ..
            }) if id == "resp_ds"
        ));
    }

    // Scenario: Agnes Responses wire uses output_items delta events for visible text.
    // Expected: the adapter maps output_items deltas to TextPart before Finished.
    // Invariant: vendor-specific decode paths share one Responses adapter implementation.
    #[tokio::test]
    async fn agnes_mock_http_stream_maps_output_items_delta() {
        const SSE_AGNES: &str = "\
data: {\"type\":\"response.output_items.delta\",\"delta\":\"pong\"}

data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_ag\",\"status\":\"completed\"}}

";

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/responses"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE_AGNES),
            )
            .mount(&server)
            .await;

        let mut wire = WireProfileConfig::default();
        wire.decode.output_text_path = Some("output_items".into());

        let adapter = OpenAiResponsesAdapter::new(server.uri(), "test".into(), wire, false, false)
            .expect("adapter");

        let mut stream = adapter.stream(sample_request());
        let mut saw_text = false;
        let mut last = None;
        while let Some(item) = stream.next().await {
            let event = item.expect("event");
            if matches!(event, ModelStreamEvent::TextPart { .. }) {
                saw_text = true;
            }
            last = Some(event);
        }
        assert!(saw_text);
        assert!(matches!(
            last,
            Some(ModelStreamEvent::Finished {
                response_id: Some(id),
                ..
            }) if id == "resp_ag"
        ));
    }
}
