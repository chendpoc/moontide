mod sse;

use std::pin::Pin;

use futures::Stream;
use futures::StreamExt;
use tokio::sync::mpsc;

use crate::llm::adapter::AdapterConfig;
use crate::llm::normalize::openai_chat::{encode_request, StreamDecoder};
use crate::llm::protocol::{LlmError, ModelRequest, ModelStreamEvent, RequestFailureKind};
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
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        let url = self.chat_completions_url();
        let client = self.client.clone();
        let api_key = self.api_key.clone();

        let (tx, rx) = mpsc::channel::<Result<ModelStreamEvent, LlmError>>(64);

        tokio::spawn(async move {
            if let Err(err) = run_stream(client, url, api_key, request, tx.clone()).await {
                let _ = tx.send(Err(err)).await;
            }
        });

        Box::pin(async_stream_from_receiver(rx))
    }
}

fn async_stream_from_receiver(
    rx: mpsc::Receiver<Result<ModelStreamEvent, LlmError>>,
) -> impl Stream<Item = Result<ModelStreamEvent, LlmError>> {
    futures::stream::unfold(rx, |mut rx| async {
        rx.recv().await.map(|item| (item, rx))
    })
}

async fn run_stream(
    client: reqwest::Client,
    url: String,
    api_key: String,
    request: ModelRequest,
    tx: mpsc::Sender<Result<ModelStreamEvent, LlmError>>,
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
            kind: match status.as_u16() {
                // 408 超时 / 429 限流：可退避重试
                408 | 429 => RequestFailureKind::Recoverable,
                // 其余 4xx：客户端错误，重试无意义
                400..=499 => RequestFailureKind::Unrecoverable,
                // 5xx 及未知：服务端 / 瞬态
                _ => RequestFailureKind::Recoverable,
            },
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
                // `[DONE]` 是 OpenAI 族的礼节帧，不是 MoonTide 协议信号，直接忽略。
                // 收束的唯一依据是 `Finished`（由 `finish_reason` 触发）
                continue;
            }
            let events = decode_sse_payload(&mut decoder, payload)?;
            for event in events {
                if tx.send(Ok(event)).await.is_err() {
                    // Consumer dropped the stream (cancel / abort), not a request failure.
                    return Ok(());
                }
            }
        }
    }

    // EOF：唯一收尾点
    if decoder.has_emitted_message_end() {
        Ok(())
    } else {
        Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Recoverable,
            message: "SSE stream ended without Finished".into(),
        })
    }
}

/// 按字节累积 SSE 字节流，在 `\n` 边界切行并做 UTF-8 解码。
/// 必须按字节缓冲：跨 chunk 的多字节 UTF-8 字符若逐 chunk `from_utf8_lossy`
/// 会被破坏为 U+FFFD 且不可恢复。
struct ByteLineBuffer {
    buffer: Vec<u8>,
}

impl ByteLineBuffer {
    fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    fn push(&mut self, chunk: &[u8]) {
        self.buffer.extend_from_slice(chunk);
    }

    /// 取出下一完整行（不含行尾 `\n`）；缓冲里没有完整行时返回 `Ok(None)`。
    fn next_line(&mut self) -> Result<Option<String>, LlmError> {
        let pos = match self.buffer.iter().position(|&b| b == b'\n') {
            Some(p) => p,
            None => return Ok(None),
        };
        let line = {
            let bytes = &self.buffer[..pos];
            std::str::from_utf8(bytes)
                .map_err(|e| LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    message: format!("invalid UTF-8 in SSE line: {e}"),
                })?
                .trim()
                .to_string()
        };
        self.buffer.drain(..=pos);
        Ok(Some(line))
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::llm::protocol::{Message, MessageContent, ModelStreamEvent, Role, StopReason};

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
    async fn mock_http_stream_ends_with_finished() {
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
            last = Some(item.expect("event"));
        }
        match last {
            Some(ModelStreamEvent::Finished { stop_reason, .. }) => {
                assert_eq!(stop_reason, StopReason::EndTurn);
            }
            other => panic!("expected Finished, got {other:?}"),
        }
    }

    #[test]
    fn utf8_char_split_across_chunks_decodes_correctly() {
        let mut buf = ByteLineBuffer::new();
        // "你" = E4 BD A0，第一字节与后两字节分属两个 chunk 到达
        buf.push(&[0xE4]);
        buf.push(&[0xBD, 0xA0, b'\n']);
        assert_eq!(buf.next_line().unwrap().unwrap(), "你");
        assert!(buf.next_line().unwrap().is_none());
    }

    #[test]
    fn invalid_utf8_line_is_unrecoverable() {
        let mut buf = ByteLineBuffer::new();
        buf.push(&[0xFF, 0xFE, b'\n']);
        assert!(matches!(
            buf.next_line(),
            Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn http_408_and_429_are_recoverable() {
        for status in [408u16, 429] {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/chat/completions"))
                .respond_with(ResponseTemplate::new(status))
                .mount(&server)
                .await;
            let adapter = OpenAiChatAdapter::new(AdapterConfig {
                base_url: server.uri(),
                api_key: "test".into(),
            })
            .expect("adapter");
            let mut stream = adapter.stream(sample_request());
            let err = stream
                .next()
                .await
                .expect("stream item")
                .expect_err("expected error");
            assert!(
                matches!(
                    err,
                    LlmError::RequestFailed {
                        kind: RequestFailureKind::Recoverable,
                        ..
                    }
                ),
                "status {status} should be Recoverable, got {err:?}"
            );
        }
    }
}
