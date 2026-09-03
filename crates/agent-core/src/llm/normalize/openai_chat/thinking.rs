use super::tool::ChatTemplateKwargs;
use super::OpenAiThinkingExtension;
use crate::llm::protocol::{
    ModelRequest,
    ModelStreamEvent,
    ThinkingLevel,
};

/// Outbound: canonical `ThinkingLevel` + resolved adapter option → OpenAI extension.
pub(super) fn encode_thinking_extensions(
    request: &ModelRequest,
    extension: OpenAiThinkingExtension,
) -> Option<ChatTemplateKwargs> {
    let enabled = matches!(
        request.thinking_level,
        Some(ThinkingLevel::Low | ThinkingLevel::Medium | ThinkingLevel::High)
    );
    if !enabled {
        return None;
    }
    match extension {
        OpenAiThinkingExtension::ChatTemplateKwargs => Some(ChatTemplateKwargs {
            enable_thinking: true,
        }),
        OpenAiThinkingExtension::None => None,
    }
}

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
    use crate::llm::protocol::{
        Message,
        MessageContent,
        Role,
    };

    // Scenario: the resolved adapter requests chat-template kwargs and thinking is enabled.
    // Expected: the encoder returns enable_thinking=true.
    // Invariant: outbound mapping does not inspect model or provider identity.
    #[test]
    fn encode_thinking_extensions_adds_kwargs_for_agnes() {
        let request = ModelRequest {
            model: "agnes-2.5-flash".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 128,
            thinking_level: Some(ThinkingLevel::Low),
            session_id: None,
            previous_response_id: None,
        };
        assert_eq!(
            encode_thinking_extensions(&request, OpenAiThinkingExtension::ChatTemplateKwargs,),
            Some(ChatTemplateKwargs {
                enable_thinking: true
            })
        );
    }

    // Scenario: no extension is resolved, then canonical thinking is disabled.
    // Expected: both cases omit chat_template_kwargs.
    // Invariant: extension selection and canonical thinking jointly gate the wire field.
    #[test]
    fn encode_thinking_extensions_skips_deepseek_and_off() {
        let mut request = ModelRequest {
            model: "deepseek-chat".into(),
            system: String::new(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text("hi".into()),
            }],
            tools: vec![],
            max_tokens: 128,
            thinking_level: Some(ThinkingLevel::High),
            session_id: None,
            previous_response_id: None,
        };
        assert!(encode_thinking_extensions(&request, OpenAiThinkingExtension::None).is_none());
        request.thinking_level = None;
        assert!(
            encode_thinking_extensions(&request, OpenAiThinkingExtension::ChatTemplateKwargs,)
                .is_none()
        );
    }

    // Scenario: the provider emits an empty and then a non-empty reasoning fragment.
    // Expected: only the non-empty fragment becomes a ThinkingPart.
    // Invariant: empty wire deltas never create observable progress blocks.
    #[test]
    fn decode_reasoning_part_skips_empty() {
        assert!(decode_reasoning_part("", 0).is_none());
        assert!(matches!(
            decode_reasoning_part("trace", 0),
            Some(ModelStreamEvent::ThinkingPart { .. })
        ));
    }

    // Scenario: a non-stream assistant response contains reasoning and visible text.
    // Expected: reasoning precedes text with stable block indices.
    // Invariant: canonical block ordering is independent of outbound options.
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
