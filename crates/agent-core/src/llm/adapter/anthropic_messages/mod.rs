mod sse;

use std::pin::Pin;

use futures::{
    Stream,
    StreamExt,
};
use tokio::sync::mpsc;

use super::sse::{
    ByteLineBuffer,
    classify_http_status,
    stream_from_receiver,
};
use crate::llm::LLMProvider;
use crate::llm::normalize::anthropic_messages::{
    EncodeOptions,
    StreamDecoder,
    encode_request,
};
use crate::llm::protocol::{
    LlmError,
    ModelRequest,
    ModelStreamEvent,
    RequestFailureKind,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Anthropic Messages API adapter (HTTP + SSE).
pub struct AnthropicMessagesAdapter {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    prompt_cache: bool,
}

impl AnthropicMessagesAdapter {
    pub fn new(base_url: String, api_key: String, prompt_cache: bool) -> Result<Self, LlmError> {
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
            prompt_cache,
        })
    }

    fn messages_url(&self) -> String {
        format!("{}/v1/messages", self.base_url)
    }
}

impl LLMProvider for AnthropicMessagesAdapter {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        let url = self.messages_url();
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let prompt_cache = self.prompt_cache;

        let (tx, rx) = mpsc::channel::<Result<ModelStreamEvent, LlmError>>(64);

        tokio::spawn(async move {
            if let Err(err) =
                run_stream(client, url, api_key, prompt_cache, request, tx.clone()).await
            {
                let _ = tx.send(Err(err)).await;
            }
        });

        Box::pin(stream_from_receiver(rx))
    }
}

async fn run_stream(
    client: reqwest::Client,
    url: String,
    api_key: String,
    prompt_cache: bool,
    request: ModelRequest,
    tx: mpsc::Sender<Result<ModelStreamEvent, LlmError>>,
) -> Result<(), LlmError> {
    let body = encode_request(&request, EncodeOptions { prompt_cache })?;

    let response = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
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

    let mut decoder = StreamDecoder::new();
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
            model: "claude".into(),
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
event: content_block_delta
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"pong\"}}

event: message_delta
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}

event: message_stop
data: {\"type\":\"message_stop\"}

";

    // Scenario: a mock Anthropic endpoint streams text and terminates with message_stop.
    // Expected: the adapter yields TextPart then Finished with EndTurn.
    // Invariant: Anthropic SSE event names are ignored; JSON type drives decoding.
    #[tokio::test]
    async fn mock_http_stream_ends_with_finished() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE_OK),
            )
            .mount(&server)
            .await;

        let adapter =
            AnthropicMessagesAdapter::new(server.uri(), "test".into(), false).expect("adapter");

        let mut stream = adapter.stream(sample_request());
        let mut last = None;
        while let Some(item) = stream.next().await {
            last = Some(item.expect("event"));
        }
        match last {
            Some(ModelStreamEvent::Finished { stop_reason, .. }) => {
                assert_eq!(stop_reason, StopReason::EndTurn);
            }
            other => panic!("expected Finished, got {other:?}"),
        }
    }
}
