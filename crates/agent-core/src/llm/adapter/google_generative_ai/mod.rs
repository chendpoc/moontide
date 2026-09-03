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
use crate::llm::normalize::google_generative_ai::{
    StreamDecoder,
    encode_request,
};
use crate::llm::protocol::{
    LlmError,
    ModelRequest,
    ModelStreamEvent,
    RequestFailureKind,
};

/// Google Generative AI adapter (HTTP + SSE via `alt=sse`).
pub struct GoogleGenerativeAiAdapter {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl GoogleGenerativeAiAdapter {
    pub fn new(base_url: String, api_key: String) -> Result<Self, LlmError> {
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
        })
    }

    fn stream_url(&self, model: &str) -> String {
        format!(
            "{}/models/{model}:streamGenerateContent?alt=sse&key={}",
            self.base_url, self.api_key
        )
    }
}

impl LLMProvider for GoogleGenerativeAiAdapter {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        let url = self.stream_url(&request.model);
        let client = self.client.clone();

        let (tx, rx) = mpsc::channel::<Result<ModelStreamEvent, LlmError>>(64);

        tokio::spawn(async move {
            if let Err(err) = run_stream(client, url, request, tx.clone()).await {
                let _ = tx.send(Err(err)).await;
            }
        });

        Box::pin(stream_from_receiver(rx))
    }
}

async fn run_stream(
    client: reqwest::Client,
    url: String,
    request: ModelRequest,
    tx: mpsc::Sender<Result<ModelStreamEvent, LlmError>>,
) -> Result<(), LlmError> {
    let body = encode_request(&request)?;

    let response = client
        .post(&url)
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
            if line.is_empty() || line.starts_with(':') {
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
        path_regex,
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
            model: "gemini-2.0-flash".into(),
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
data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"pong\"}],\"role\":\"model\"}}]}

data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\"}],\"role\":\"model\"},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1}}

";

    // Scenario: a mock Gemini streamGenerateContent endpoint emits text then STOP.
    // Expected: the adapter yields TextPart then Finished with EndTurn.
    // Invariant: API key travels in the query string per Gemini REST contract.
    #[tokio::test]
    async fn mock_http_stream_ends_with_finished() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path_regex(r"/models/.+:streamGenerateContent"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE_OK),
            )
            .mount(&server)
            .await;

        let adapter =
            GoogleGenerativeAiAdapter::new(server.uri(), "test-key".into()).expect("adapter");

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
