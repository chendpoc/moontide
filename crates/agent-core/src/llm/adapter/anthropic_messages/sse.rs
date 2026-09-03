use crate::llm::normalize::anthropic_messages::{
    AnthropicStreamEvent,
    StreamDecoder,
};
use crate::llm::protocol::{
    LlmError,
    ModelStreamEvent,
    RequestFailureKind,
};

/// Incrementally feed one SSE `data:` payload (without the `data:` prefix).
pub fn decode_sse_payload(
    decoder: &mut StreamDecoder,
    payload: &str,
) -> Result<Vec<ModelStreamEvent>, LlmError> {
    if payload.trim().is_empty() {
        return Ok(Vec::new());
    }
    let event: AnthropicStreamEvent =
        serde_json::from_str(payload).map_err(|e| LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: format!("invalid SSE JSON: {e}"),
        })?;
    decoder.decode_event(&event)
}
