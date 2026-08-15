use crate::llm::normalize::openai_chat::{ChatCompletionChunk, StreamDecoder};
use crate::llm::protocol::{LlmError, RequestFailureKind, StreamDelta};

/// Incrementally feed one SSE `data:` payload (without the `data:` prefix).
pub fn decode_sse_payload(
    decoder: &mut StreamDecoder,
    payload: &str,
) -> Result<Vec<StreamDelta>, LlmError> {
    if payload.trim() == "[DONE]" {
        return Ok(Vec::new());
    }
    let chunk: ChatCompletionChunk =
        serde_json::from_str(payload).map_err(|e| LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: format!("invalid SSE JSON: {e}"),
        })?;
    Ok(decoder.decode_chunk(&chunk))
}
