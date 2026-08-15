use crate::llm::protocol::StreamDelta;

/// Streaming: wire `reasoning_content` fragment → [`StreamDelta::ThinkingDelta`].
pub fn decode_reasoning_delta(reasoning: &str) -> Option<StreamDelta> {
    if reasoning.is_empty() {
        None
    } else {
        Some(StreamDelta::ThinkingDelta {
            thinking: reasoning.to_string(),
        })
    }
}

/// Non-stream assistant chunk may include both visible text and reasoning.
pub fn split_assistant_text(content: Option<&str>, reasoning: Option<&str>) -> Vec<StreamDelta> {
    let mut deltas = Vec::new();
    if let Some(reasoning) = reasoning {
        if let Some(delta) = decode_reasoning_delta(reasoning) {
            deltas.push(delta);
        }
    }
    if let Some(text) = content {
        if !text.is_empty() {
            deltas.push(StreamDelta::TextDelta {
                text: text.to_string(),
            });
        }
    }
    deltas
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_reasoning_delta_skips_empty() {
        assert!(decode_reasoning_delta("").is_none());
        assert!(matches!(
            decode_reasoning_delta("trace"),
            Some(StreamDelta::ThinkingDelta { .. })
        ));
    }

    #[test]
    fn split_assistant_text_orders_reasoning_before_text() {
        let deltas = split_assistant_text(Some("hi"), Some("why"));
        assert_eq!(deltas.len(), 2);
        assert!(matches!(deltas[0], StreamDelta::ThinkingDelta { .. }));
        assert!(matches!(deltas[1], StreamDelta::TextDelta { .. }));
    }
}
