use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use crate::llm::protocol::{
    LlmError,
    ModelStreamEvent,
    RequestFailureKind,
    StopReason,
    Usage,
};

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub index: Option<u32>,
    #[serde(default)]
    pub delta: Option<AnthropicDelta>,
    #[serde(default)]
    pub content_block: Option<AnthropicContentBlock>,
    #[serde(default)]
    pub usage: Option<AnthropicUsage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicDelta {
    #[serde(rename = "type")]
    pub delta_type: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub partial_json: Option<String>,
    #[serde(default)]
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

#[derive(Debug)]
struct ToolBlockState {
    id: String,
    name: String,
    arguments: String,
    started: bool,
}

#[derive(Debug, Default)]
pub struct StreamDecoder {
    tool_blocks: BTreeMap<u32, ToolBlockState>,
    message_end_emitted: bool,
    stop_reason: Option<StopReason>,
    usage: Option<Usage>,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has_emitted_message_end(&self) -> bool {
        self.message_end_emitted
    }

    pub fn decode_event(
        &mut self,
        event: &AnthropicStreamEvent,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        if self.message_end_emitted {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();
        match event.event_type.as_str() {
            "content_block_start" => {
                if let Some(block) = &event.content_block
                    && block.block_type == "tool_use"
                {
                    let index = event.index.unwrap_or(0);
                    let id = block.id.clone().unwrap_or_default();
                    let name = block.name.clone().unwrap_or_default();
                    self.tool_blocks.insert(
                        index,
                        ToolBlockState {
                            id: id.clone(),
                            name: name.clone(),
                            arguments: String::new(),
                            started: false,
                        },
                    );
                    if !id.is_empty() && !name.is_empty() {
                        events.push(ModelStreamEvent::ToolUseStarted { id, name });
                        if let Some(entry) = self.tool_blocks.get_mut(&index) {
                            entry.started = true;
                        }
                    }
                }
            }
            "content_block_delta" => {
                events.extend(self.handle_content_block_delta(event)?);
            }
            "message_delta" => {
                if let Some(delta) = &event.delta
                    && let Some(reason) = delta.stop_reason.as_deref()
                {
                    self.stop_reason = Some(map_stop_reason(reason));
                }
                if let Some(usage) = &event.usage {
                    self.usage = Some(Usage {
                        input_tokens: usage.input_tokens.unwrap_or(0),
                        output_tokens: usage.output_tokens.unwrap_or(0),
                    });
                }
            }
            "message_stop" => {
                for state in self.tool_blocks.values() {
                    if state.started && !state.arguments.is_empty() {
                        let input = parse_tool_input(&state.arguments)?;
                        events.push(ModelStreamEvent::ToolUseFinished {
                            id: state.id.clone(),
                            name: state.name.clone(),
                            input,
                        });
                    }
                }
                self.tool_blocks.clear();
                events.push(ModelStreamEvent::Finished {
                    stop_reason: self.stop_reason.clone().unwrap_or(StopReason::EndTurn),
                    usage: self.usage.take(),
                    response_id: None,
                });
                self.message_end_emitted = true;
            }
            "error" => {
                return Err(LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    message: "anthropic stream error event".into(),
                });
            }
            _ => {}
        }

        Ok(events)
    }

    fn handle_content_block_delta(
        &mut self,
        event: &AnthropicStreamEvent,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        let mut events = Vec::new();
        let Some(delta) = &event.delta else {
            return Ok(events);
        };
        let delta_type = delta.delta_type.as_deref().unwrap_or_default();
        match delta_type {
            "text_delta" => {
                if let Some(text) = delta.text.as_deref()
                    && !text.is_empty()
                {
                    events.push(ModelStreamEvent::TextPart {
                        block_index: event.index.unwrap_or(0),
                        text: text.to_string(),
                    });
                }
            }
            "thinking_delta" => {
                if let Some(thinking) = delta.thinking.as_deref()
                    && !thinking.is_empty()
                {
                    events.push(ModelStreamEvent::ThinkingPart {
                        block_index: event.index.unwrap_or(0),
                        thinking: thinking.to_string(),
                    });
                }
            }
            "input_json_delta" => {
                let index = event.index.unwrap_or(0);
                if let Some(partial) = delta.partial_json.as_deref() {
                    if partial.is_empty() {
                        return Ok(events);
                    }
                    let entry = self
                        .tool_blocks
                        .entry(index)
                        .or_insert_with(|| ToolBlockState {
                            id: String::new(),
                            name: String::new(),
                            arguments: String::new(),
                            started: false,
                        });
                    entry.arguments.push_str(partial);
                    if entry.started && !entry.id.is_empty() {
                        events.push(ModelStreamEvent::ToolUsePart {
                            id: entry.id.clone(),
                            input_json: partial.to_string(),
                        });
                    }
                }
            }
            _ => {}
        }
        Ok(events)
    }
}

fn parse_tool_input(arguments: &str) -> Result<Value, LlmError> {
    if arguments.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(arguments).map_err(|e| LlmError::RequestFailed {
        kind: RequestFailureKind::Unrecoverable,
        message: format!("invalid tool arguments JSON: {e}"),
    })
}

fn map_stop_reason(reason: &str) -> StopReason {
    match reason {
        "end_turn" => StopReason::EndTurn,
        "tool_use" => StopReason::ToolUse,
        "max_tokens" => StopReason::MaxTokens,
        other => StopReason::Other(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: Anthropic emits text deltas followed by message_stop.
    // Expected: decoder produces TextPart then Finished with mapped stop reason.
    // Invariant: message_stop is the sole stream termination signal.
    #[test]
    fn text_delta_and_message_stop_finish_stream() {
        let mut decoder = StreamDecoder::new();
        let text = decoder
            .decode_event(
                &serde_json::from_str(
                    r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}"#,
                )
                .expect("event"),
            )
            .expect("text");
        assert!(matches!(
            text.first(),
            Some(ModelStreamEvent::TextPart { .. })
        ));

        decoder
            .decode_event(
                &serde_json::from_str(
                    r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}"#,
                )
                .expect("event"),
            )
            .expect("delta");

        let finished = decoder
            .decode_event(&serde_json::from_str(r#"{"type":"message_stop"}"#).expect("event"))
            .expect("finished");
        assert!(matches!(
            finished.last(),
            Some(ModelStreamEvent::Finished {
                stop_reason: StopReason::EndTurn,
                ..
            })
        ));
    }
}
