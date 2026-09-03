use crate::llm::protocol::{
    ContentBlock,
    LlmError,
    Message,
    MessageContent,
    ModelRequest,
    RequestFailureKind,
};

/// Which blocks to keep when handing history to a target adapter family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandoffPolicy {
    /// Strip [`ContentBlock::Thinking`] (e.g. OpenAI Chat without reasoning support).
    pub strip_thinking: bool,
}

impl HandoffPolicy {
    pub const OPENAI_CHAT_COMPLETIONS: Self = Self {
        strip_thinking: true,
    };

    pub const ANTHROPIC_MESSAGES: Self = Self {
        strip_thinking: false,
    };
}

/// Pre-flight validation before encode / HTTP.
pub fn validate_request(request: &ModelRequest) -> Result<(), LlmError> {
    if request.model.trim().is_empty() {
        return Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "model must not be empty".into(),
        });
    }
    if request.messages.is_empty() {
        return Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "messages must not be empty".into(),
        });
    }
    if request.max_tokens == 0 {
        return Err(LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "max_tokens must be greater than zero".into(),
        });
    }
    Ok(())
}

/// Remove blocks incompatible with the target wire family. Never panics.
pub fn sanitize_messages_for_handoff(
    messages: Vec<Message>,
    policy: HandoffPolicy,
) -> Vec<Message> {
    if !policy.strip_thinking {
        return messages;
    }

    messages
        .into_iter()
        .filter_map(|message| sanitize_message(message, policy))
        .collect()
}

fn sanitize_message(message: Message, policy: HandoffPolicy) -> Option<Message> {
    let content = match message.content {
        MessageContent::Text(text) => MessageContent::Text(text),
        MessageContent::Blocks(blocks) => {
            let blocks = sanitize_blocks(blocks, policy);
            if blocks.is_empty() {
                return None;
            }
            MessageContent::Blocks(blocks)
        }
    };

    Some(Message {
        role: message.role,
        content,
    })
}

fn sanitize_blocks(blocks: Vec<ContentBlock>, policy: HandoffPolicy) -> Vec<ContentBlock> {
    blocks
        .into_iter()
        .filter_map(|block| sanitize_block(block, policy))
        .collect()
}

fn sanitize_block(block: ContentBlock, policy: HandoffPolicy) -> Option<ContentBlock> {
    match block {
        ContentBlock::Thinking { .. } if policy.strip_thinking => None,
        ContentBlock::ToolResult {
            tool_use_id,
            content,
        } => Some(ContentBlock::ToolResult {
            tool_use_id,
            content: match content {
                crate::llm::protocol::ToolResultContent::Text(text) => {
                    crate::llm::protocol::ToolResultContent::Text(text)
                }
                crate::llm::protocol::ToolResultContent::Blocks(nested) => {
                    let nested = sanitize_blocks(nested, policy);
                    if nested.is_empty() {
                        return None;
                    }
                    crate::llm::protocol::ToolResultContent::Blocks(nested)
                }
            },
        }),
        other => Some(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::Role;

    fn sample_request(messages: Vec<Message>) -> ModelRequest {
        ModelRequest {
            model: "m".into(),
            system: String::new(),
            messages,
            tools: vec![],
            max_tokens: 64,
            thinking_level: None,
            session_id: None,
            previous_response_id: None,
        }
    }

    // Scenario: validate_request rejects an empty message list before encode/HTTP.
    // Expected: Unrecoverable RequestFailed is returned.
    // Invariant: adapters never see a ModelRequest with zero messages.
    #[test]
    fn validate_rejects_empty_messages() {
        let err = validate_request(&sample_request(vec![])).unwrap_err();
        assert!(matches!(
            err,
            LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                ..
            }
        ));
    }

    // Scenario: validate_request rejects whitespace-only model id.
    // Expected: encoding is blocked with Unrecoverable RequestFailed.
    // Invariant: empty model strings cannot reach provider HTTP.
    #[test]
    fn validate_rejects_empty_model() {
        let mut request = sample_request(vec![Message {
            role: Role::User,
            content: MessageContent::Text("hi".into()),
        }]);
        request.model = "  ".into();
        assert!(validate_request(&request).is_err());
    }

    // Scenario: OpenAI Chat handoff policy strips thinking blocks from assistant history.
    // Expected: only Text blocks remain in sanitized messages.
    // Invariant: thinking is removed before OpenAI Chat encode, not at Session layer.
    #[test]
    fn handoff_strips_thinking_blocks() {
        let messages = vec![Message {
            role: Role::Assistant,
            content: MessageContent::Blocks(vec![
                ContentBlock::Thinking {
                    thinking: "secret".into(),
                },
                ContentBlock::Text {
                    text: "hello".into(),
                },
            ]),
        }];
        let sanitized =
            sanitize_messages_for_handoff(messages, HandoffPolicy::OPENAI_CHAT_COMPLETIONS);
        assert_eq!(sanitized.len(), 1);
        match &sanitized[0].content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 1);
                assert!(matches!(blocks[0], ContentBlock::Text { .. }));
            }
            other => panic!("expected blocks, got {other:?}"),
        }
    }

    // Scenario: Anthropic handoff policy retains thinking blocks in assistant history.
    // Expected: Thinking blocks survive sanitize_messages_for_handoff.
    // Invariant: Anthropic Messages encode receives thinking when policy allows it.
    #[test]
    fn handoff_keeps_thinking_for_anthropic() {
        let messages = vec![Message {
            role: Role::Assistant,
            content: MessageContent::Blocks(vec![ContentBlock::Thinking {
                thinking: "trace".into(),
            }]),
        }];
        let sanitized = sanitize_messages_for_handoff(messages, HandoffPolicy::ANTHROPIC_MESSAGES);
        assert_eq!(sanitized.len(), 1);
    }
}
