use std::mem;

use crate::llm::protocol::{
    ContentBlock, LlmError, ModelResponse, ModelResponseSnapshot, ModelStreamEvent, PendingBlock,
    RequestFailureKind, StopReason, Usage,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenPartKind {
    Text { block_index: u32 },
    Thinking { block_index: u32 },
}

#[derive(Debug, Clone)]
struct OpenTool {
    id: String,
    name: String,
    input_json: String,
}

/// Authoritative fold from [`ModelStreamEvent`] to [`ModelResponse`].
#[derive(Debug)]
pub struct ModelResponseBuilder {
    model: Option<String>,
    content: Vec<ContentBlock>,
    open_part: Option<OpenPartKind>,
    open_text: String,
    open_thinking: String,
    open_tool: Option<OpenTool>,
    stop_reason: Option<StopReason>,
    usage: Option<Usage>,
    finished: bool,
}

impl ModelResponseBuilder {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: Some(model.into()),
            content: Vec::new(),
            open_part: None,
            open_text: String::new(),
            open_thinking: String::new(),
            open_tool: None,
            stop_reason: None,
            usage: None,
            finished: false,
        }
    }

    pub fn apply(&mut self, event: ModelStreamEvent) -> Result<ModelResponseSnapshot, LlmError> {
        if self.finished {
            return Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: "stream already finished".into(),
            });
        }

        match event {
            ModelStreamEvent::TextPart { block_index, text } => {
                self.ensure_text_part(block_index)?;
                self.open_text.push_str(&text);
            }
            ModelStreamEvent::ThinkingPart {
                block_index,
                thinking,
            } => {
                self.ensure_thinking_part(block_index)?;
                self.open_thinking.push_str(&thinking);
            }
            ModelStreamEvent::ToolUseStarted { id, name } => {
                self.flush_open_part();
                if self.open_tool.is_some() {
                    return Err(LlmError::RequestFailed {
                        kind: RequestFailureKind::Unrecoverable,
                        message: format!("nested ToolUseStarted for {id}"),
                    });
                }
                self.open_tool = Some(OpenTool {
                    id,
                    name,
                    input_json: String::new(),
                });
            }
            ModelStreamEvent::ToolUsePart { id, input_json } => {
                let tool = self
                    .open_tool
                    .as_mut()
                    .ok_or_else(|| LlmError::RequestFailed {
                        kind: RequestFailureKind::Unrecoverable,
                        message: format!("ToolUsePart without ToolUseStarted for {id}"),
                    })?;
                if tool.id != id {
                    return Err(LlmError::RequestFailed {
                        kind: RequestFailureKind::Unrecoverable,
                        message: format!("ToolUsePart id mismatch: expected {}, got {id}", tool.id),
                    });
                }
                tool.input_json.push_str(&input_json);
            }
            ModelStreamEvent::ToolUseFinished { id, name, input } => {
                if let Some(open) = self.open_tool.take() {
                    if open.id != id {
                        return Err(LlmError::RequestFailed {
                            kind: RequestFailureKind::Unrecoverable,
                            message: format!(
                                "ToolUseFinished id mismatch: expected {}, got {id}",
                                open.id
                            ),
                        });
                    }
                }
                self.content.push(ContentBlock::ToolUse { id, name, input });
            }
            ModelStreamEvent::Finished { stop_reason, usage } => {
                self.flush_open_part();
                self.stop_reason = Some(stop_reason);
                self.usage = usage;
                self.finished = true;
            }
        }

        Ok(self.snapshot())
    }

    pub fn snapshot(&self) -> ModelResponseSnapshot {
        ModelResponseSnapshot {
            content: self.content.clone(),
            pending: self.pending_block(),
            stop_reason: self.stop_reason.clone(),
            usage: self.usage,
            model: self.model.clone(),
        }
    }

    pub fn finish(self) -> Result<ModelResponse, LlmError> {
        if !self.finished {
            return Err(LlmError::RequestFailed {
                kind: RequestFailureKind::Unrecoverable,
                message: "stream ended without Finished".into(),
            });
        }
        let stop_reason = self.stop_reason.ok_or_else(|| LlmError::RequestFailed {
            kind: RequestFailureKind::Unrecoverable,
            message: "Finished without stop_reason".into(),
        })?;
        Ok(ModelResponse {
            content: self.content,
            stop_reason,
            usage: self.usage,
            model: self.model,
        })
    }

    fn ensure_text_part(&mut self, block_index: u32) -> Result<(), LlmError> {
        let needs_flush = match self.open_part {
            Some(OpenPartKind::Text {
                block_index: current,
            }) => current != block_index,
            Some(OpenPartKind::Thinking { .. }) | None => true,
        };
        if needs_flush {
            self.flush_open_part();
            self.open_part = Some(OpenPartKind::Text { block_index });
        }
        Ok(())
    }

    fn ensure_thinking_part(&mut self, block_index: u32) -> Result<(), LlmError> {
        let needs_flush = match self.open_part {
            Some(OpenPartKind::Thinking {
                block_index: current,
            }) => current != block_index,
            Some(OpenPartKind::Text { .. }) | None => true,
        };
        if needs_flush {
            self.flush_open_part();
            self.open_part = Some(OpenPartKind::Thinking { block_index });
        }
        Ok(())
    }

    fn flush_open_part(&mut self) {
        match self.open_part.take() {
            Some(OpenPartKind::Text { .. }) if !self.open_text.is_empty() => {
                self.content.push(ContentBlock::Text {
                    text: mem::take(&mut self.open_text),
                });
            }
            Some(OpenPartKind::Thinking { .. }) if !self.open_thinking.is_empty() => {
                self.content.push(ContentBlock::Thinking {
                    thinking: mem::take(&mut self.open_thinking),
                });
            }
            _ => {}
        }
    }

    fn pending_block(&self) -> Option<PendingBlock> {
        if let Some(tool) = &self.open_tool {
            return Some(PendingBlock::ToolUse {
                id: tool.id.clone(),
                name: tool.name.clone(),
                input_json: tool.input_json.clone(),
            });
        }
        match self.open_part {
            Some(OpenPartKind::Text { .. }) if !self.open_text.is_empty() => {
                Some(PendingBlock::Text {
                    text: self.open_text.clone(),
                })
            }
            Some(OpenPartKind::Thinking { .. }) if !self.open_thinking.is_empty() => {
                Some(PendingBlock::Thinking {
                    thinking: self.open_thinking.clone(),
                })
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::protocol::ModelStreamEvent;
    use serde_json::json;

    fn apply_all(builder: &mut ModelResponseBuilder, events: &[ModelStreamEvent]) {
        for event in events {
            builder.apply(event.clone()).expect("apply should succeed");
        }
    }

    #[test]
    fn interleaved_block_index_preserves_order() {
        let mut builder = ModelResponseBuilder::new("m");
        apply_all(
            &mut builder,
            &[
                ModelStreamEvent::TextPart {
                    block_index: 0,
                    text: "a".into(),
                },
                ModelStreamEvent::ThinkingPart {
                    block_index: 1,
                    thinking: "b".into(),
                },
                ModelStreamEvent::TextPart {
                    block_index: 2,
                    text: "c".into(),
                },
                ModelStreamEvent::Finished {
                    stop_reason: StopReason::EndTurn,
                    usage: None,
                },
            ],
        );
        let response = builder.finish().expect("finish");
        assert_eq!(
            response.content,
            vec![
                ContentBlock::Text { text: "a".into() },
                ContentBlock::Thinking {
                    thinking: "b".into()
                },
                ContentBlock::Text { text: "c".into() },
            ]
        );
    }

    #[test]
    fn tool_use_finished_populates_content_block() {
        let mut builder = ModelResponseBuilder::new("m");
        apply_all(
            &mut builder,
            &[
                ModelStreamEvent::ToolUseStarted {
                    id: "t1".into(),
                    name: "read".into(),
                },
                ModelStreamEvent::ToolUsePart {
                    id: "t1".into(),
                    input_json: "{\"path\":\"a.rs\"}".into(),
                },
                ModelStreamEvent::ToolUseFinished {
                    id: "t1".into(),
                    name: "read".into(),
                    input: json!({"path": "a.rs"}),
                },
                ModelStreamEvent::Finished {
                    stop_reason: StopReason::ToolUse,
                    usage: None,
                },
            ],
        );
        let response = builder.finish().expect("finish");
        assert!(matches!(
            response.content.first(),
            Some(ContentBlock::ToolUse { .. })
        ));
    }

    #[test]
    fn finish_errors_without_finished_event() {
        let mut builder = ModelResponseBuilder::new("m");
        builder
            .apply(ModelStreamEvent::TextPart {
                block_index: 0,
                text: "x".into(),
            })
            .expect("apply");
        assert!(builder.finish().is_err());
    }
}
