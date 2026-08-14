mod sse;

use std::pin::Pin;

use futures::Stream;
use futures::StreamExt;
use tokio::sync::mpsc;

use crate::llm::adapter::AdapterConfig;
use crate::llm::normalize::openai_chat::{encode_request, StreamDecoder};
use crate::llm::protocol::{LlmError, ModelRequest, RequestFailureKind, StreamDelta};
use crate::llm::LLMProvider;

use sse::decode_sse_payload;

/// DeepSeek / OpenAI Chat Completions adapter (fetch + SSE).
pub struct OpenAiChatAdapter {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl OpenAiChatAdapter {
    pub fn new(config: AdapterConfig) -> Result<Self, LlmError> {
        if config.base_url.trim().is_empty() {
            return Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: "base_url must not be empty".into(),
            });
        }
        Ok(Self {
            client: reqwest::Client::new(),
            base_url: config.base_url.trim_end_matches('/').to_string(),
            api_key: config.api_key,
        })
    }

    fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }
}

impl LLMProvider for OpenAiChatAdapter {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<StreamDelta, LlmError>> + Send + '_>> {
        let url = self.chat_completions_url();
        let client = self.client.clone();
        let api_key = self.api_key.clone();

        let (tx, rx) = mpsc::channel::<Result<StreamDelta, LlmError>>(64);

        tokio::spawn(async move {
            if let Err(err) = run_stream(client, url, api_key, request, tx.clone()).await {
                let _ = tx.send(Err(err)).await;
            }
        });

        Box::pin(async_stream_from_receiver(rx))
    }
}

fn async_stream_from_receiver(
    rx: mpsc::Receiver<Result<StreamDelta, LlmError>>,
) -> impl Stream<Item = Result<StreamDelta, LlmError>> {
    futures::stream::unfold(rx, |mut rx| async {
        rx.recv().await.map(|item| (item, rx))
    })
}

async fn run_stream(
    client: reqwest::Client,
    url: String,
    api_key: String,
    request: ModelRequest,
    tx: mpsc::Sender<Result<StreamDelta, LlmError>>,
) -> Result<(), LlmError> {
    let body = encode_request(&request)?;

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
            kind: if status.is_client_error() {
                RequestFailureKind::Unrecoverable
            } else {
                RequestFailureKind::Recoverable
            },
            message: format!("HTTP {status}: {text}"),
        });
    }

    let mut decoder = StreamDecoder::new();
    let mut buffer = String::new();
    let mut byte_stream = response.bytes_stream();

    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| LlmError::RequestFailed {
            kind: RequestFailureKind::Recoverable,
            message: format!("SSE read failed: {e}"),
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer.drain(..=pos);
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let payload = line
                .strip_prefix("data:")
                .map(str::trim)
                .unwrap_or(&line);
            if payload == "[DONE]" {
                return Ok(());
            }
            let deltas = decode_sse_payload(&mut decoder, payload)?;
            for delta in deltas {
                if tx.send(Ok(delta)).await.is_err() {
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::llm::protocol::{Message, MessageContent, Role, StopReason, StreamDelta};

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

    const SSE_OK: &str = "\
data: {\"choices\":[{\"delta\":{\"content\":\"pong\"},\"finish_reason\":null}]}

data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}

data: [DONE]
";

    #[tokio::test]
    async fn mock_http_stream_ends_with_message_end() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(SSE_OK),
            )
            .mount(&server)
            .await;

        let adapter = OpenAiChatAdapter::new(AdapterConfig {
            base_url: server.uri(),
            api_key: "test".into(),
        })
        .expect("adapter");

        let mut stream = adapter.stream(sample_request());
        let mut last = None;
        while let Some(item) = stream.next().await {
            last = Some(item.expect("delta"));
        }
        match last {
            Some(StreamDelta::MessageEnd { stop_reason, .. }) => {
                assert_eq!(stop_reason, StopReason::EndTurn);
            }
            other => panic!("expected MessageEnd, got {other:?}"),
        }
    }
}
