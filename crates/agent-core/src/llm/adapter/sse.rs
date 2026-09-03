use futures::Stream;

use crate::llm::protocol::{
    LlmError,
    ModelStreamEvent,
    RequestFailureKind,
};

/// Classify HTTP status for retry policy (shared across wire adapters).
pub fn classify_http_status(status: u16) -> RequestFailureKind {
    match status {
        408 | 429 => RequestFailureKind::Recoverable,
        400..=499 => RequestFailureKind::Unrecoverable,
        _ => RequestFailureKind::Recoverable,
    }
}

/// Turn an mpsc receiver into a `Stream` for adapter `stream()` implementations.
pub fn stream_from_receiver(
    rx: tokio::sync::mpsc::Receiver<Result<ModelStreamEvent, LlmError>>,
) -> impl Stream<Item = Result<ModelStreamEvent, LlmError>> {
    futures::stream::unfold(rx, |mut rx| async {
        rx.recv().await.map(|item| (item, rx))
    })
}

/// Accumulate SSE byte chunks and decode complete UTF-8 lines.
pub struct ByteLineBuffer {
    buffer: Vec<u8>,
}

impl ByteLineBuffer {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.buffer.extend_from_slice(chunk);
    }

    pub fn next_line(&mut self) -> Result<Option<String>, LlmError> {
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
    use super::*;

    // Scenario: one UTF-8 code point is split across two transport chunks.
    // Expected: byte buffering reconstructs the original line.
    // Invariant: chunk boundaries never introduce replacement characters.
    #[test]
    fn utf8_char_split_across_chunks_decodes_correctly() {
        let mut buf = ByteLineBuffer::new();
        buf.push(&[0xE4]);
        buf.push(&[0xBD, 0xA0, b'\n']);
        assert_eq!(buf.next_line().unwrap().unwrap(), "你");
        assert!(buf.next_line().unwrap().is_none());
    }

    // Scenario: an SSE line contains invalid UTF-8 bytes.
    // Expected: line decoding returns an unrecoverable request error.
    // Invariant: malformed provider bytes are never normalized as valid text.
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
}
