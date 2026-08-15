use crate::llm::protocol::ModelStreamEvent;

/// Streaming: wire `reasoning_content` fragment → [`ModelStreamEvent::ThinkingPart`].
pub fn decode_reasoning_part(reasoning: &str, block_index: u32) -> Option<ModelStreamEvent> {
    if reasoning.is_empty() {
        None
    } else {
        Some(ModelStreamEvent::ThinkingPart {
            block_index,
            thinking: reasoning.to_string(),
        })
    }
}

/// Non-stream assistant chunk may include both visible text and reasoning.
pub fn split_assistant_text(
    content: Option<&str>,
    reasoning: Option<&str>,
) -> Vec<ModelStreamEvent> {
    let mut events = Vec::new();
    let had_reasoning = reasoning.is_some_and(|r| !r.is_empty());
    if let Some(reasoning) = reasoning {
        if let Some(event) = decode_reasoning_part(reasoning, 0) {
            events.push(event);
        }
    }
    if let Some(text) = content {
        if !text.is_empty() {
            let block_index = u32::from(had_reasoning);
            events.push(ModelStreamEvent::TextPart {
                block_index,
                text: text.to_string(),
            });
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_reasoning_part_skips_empty() {
        assert!(decode_reasoning_part("", 0).is_none());
        assert!(matches!(
            decode_reasoning_part("trace", 0),
            Some(ModelStreamEvent::ThinkingPart { .. })
        ));
    }

    #[test]
    fn split_assistant_text_orders_reasoning_before_text() {
        let events = split_assistant_text(Some("hi"), Some("why"));
        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0],
            ModelStreamEvent::ThinkingPart { block_index: 0, .. }
        ));
        assert!(matches!(
            events[1],
            ModelStreamEvent::TextPart { block_index: 1, .. }
        ));
    }
}
