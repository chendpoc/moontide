use crate::llm::normalize::openai_chat::{ChatCompletionChunk, StreamDecoder};
use crate::llm::protocol::{LlmError, RequestFailureKind, StreamDelta};

/// Parse OpenAI-style SSE `data:` lines into MoonTide stream deltas.
pub fn parse_sse_data_lines(body: &str) -> Result<Vec<StreamDelta>, LlmError> {
    let mut decoder = StreamDecoder::new();
    let mut deltas = Vec::new();

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let payload = line
            .strip_prefix("data:")
            .map(str::trim)
            .unwrap_or(line);
        if payload == "[DONE]" {
            break;
        }
        let chunk: ChatCompletionChunk = serde_json::from_str(payload).map_err(|e| {
            LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: format!("invalid SSE JSON: {e}"),
            }
        })?;
        deltas.extend(decoder.decode_chunk(&chunk));
    }

    Ok(deltas)
}

/// Incrementally feed one SSE `data:` payload (without the `data:` prefix).
pub fn decode_sse_payload(decoder: &mut StreamDecoder, payload: &str) -> Result<Vec<StreamDelta>, LlmError> {
    if payload.trim() == "[DONE]" {
        return Ok(Vec::new());
    }
    let chunk: ChatCompletionChunk = serde_json::from_str(payload).map_err(|e| {
        LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: format!("invalid SSE JSON: {e}"),
        }
    })?;
    Ok(decoder.decode_chunk(&chunk))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::{StopReason, StreamDelta};

    #[test]
    fn parse_text_sse_fixture() {
        let body = "\
data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}

data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3}}

data: [DONE]
";
        let deltas = parse_sse_data_lines(body).expect("parse");
        assert!(matches!(deltas.first(), Some(StreamDelta::TextDelta { .. })));
        assert!(matches!(
            deltas.last(),
            Some(StreamDelta::MessageEnd {
                stop_reason: StopReason::EndTurn,
                ..
            })
        ));
    }
}
