use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::llm::protocol::{LlmError, ModelStreamEvent, RequestFailureKind, StopReason, Usage};

use super::thinking::split_assistant_text;

/// Parsed SSE JSON payload (one `data:` line body).
#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletionChunk {
    #[serde(default)]
    pub choices: Vec<ChunkChoice>,
    pub usage: Option<ChunkUsage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChunkChoice {
    pub delta: ChunkDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ChunkDelta {
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCallDelta>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCallDelta {
    pub index: u32,
    pub id: Option<String>,
    #[serde(default)]
    pub function: FunctionDelta,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct FunctionDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChunkUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

#[derive(Debug)]
struct ToolCallState {
    id: String,
    name: String,
    arguments: String,
    started: bool,
}

/// Stateful decoder: merges fragmented tool `arguments` before [`ModelStreamEvent::ToolUseFinished`].
#[derive(Debug, Default)]
pub struct StreamDecoder {
    tool_calls: HashMap<u32, ToolCallState>,
    message_end_emitted: bool,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has_emitted_message_end(&self) -> bool {
        self.message_end_emitted
    }

    pub fn decode_chunk(
        &mut self,
        chunk: &ChatCompletionChunk,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        if self.message_end_emitted {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();
        for choice in &chunk.choices {
            if !choice.delta.tool_calls.is_empty() {
                for tool_delta in &choice.delta.tool_calls {
                    events.extend(self.apply_tool_delta(tool_delta)?);
                }
            } else {
                events.extend(split_assistant_text(
                    choice.delta.content.as_deref(),
                    choice.delta.reasoning_content.as_deref(),
                ));
            }

            if let Some(reason) = choice.finish_reason.as_deref() {
                let usage = chunk.usage.as_ref().map(chunk_usage_to_usage);
                events.extend(self.finish(reason, usage)?);
            }
        }

        Ok(events)
    }

    fn apply_tool_delta(
        &mut self,
        tool_delta: &ToolCallDelta,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        let mut events = Vec::new();
        let entry = self
            .tool_calls
            .entry(tool_delta.index)
            .or_insert_with(|| ToolCallState {
                id: String::new(),
                name: String::new(),
                arguments: String::new(),
                started: false,
            });

        if let Some(id) = &tool_delta.id {
            entry.id.clone_from(id);
        }
        if let Some(name) = &tool_delta.function.name {
            entry.name.clone_from(name);
        }
        if let Some(args) = &tool_delta.function.arguments {
            if !args.is_empty() {
                entry.arguments.push_str(args);
                if entry.started {
                    events.push(ModelStreamEvent::ToolUsePart {
                        id: entry.id.clone(),
                        input_json: args.clone(),
                    });
                }
            }
        }

        if !entry.started && !entry.id.is_empty() && !entry.name.is_empty() {
            entry.started = true;
            events.push(ModelStreamEvent::ToolUseStarted {
                id: entry.id.clone(),
                name: entry.name.clone(),
            });
            if !entry.arguments.is_empty() {
                events.push(ModelStreamEvent::ToolUsePart {
                    id: entry.id.clone(),
                    input_json: entry.arguments.clone(),
                });
            }
        }

        Ok(events)
    }

    fn finish(
        &mut self,
        finish_reason: &str,
        usage: Option<Usage>,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        let mut events = Vec::new();

        if finish_reason == "tool_calls" || finish_reason == "stop" {
            for state in self.tool_calls.values() {
                if state.started {
                    let input = parse_tool_input(&state.arguments)?;
                    events.push(ModelStreamEvent::ToolUseFinished {
                        id: state.id.clone(),
                        name: state.name.clone(),
                        input,
                    });
                }
            }
            self.tool_calls.clear();
        }

        events.push(ModelStreamEvent::Finished {
            stop_reason: map_finish_reason(finish_reason),
            usage,
        });
        self.message_end_emitted = true;
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

#[cfg(test)]
fn decode_stream_chunk(chunk: &ChatCompletionChunk) -> Vec<ModelStreamEvent> {
    let mut decoder = StreamDecoder::new();
    decoder.decode_chunk(chunk).expect("decode chunk")
}

pub fn map_finish_reason(finish_reason: &str) -> StopReason {
    match finish_reason {
        "stop" => StopReason::EndTurn,
        "tool_calls" => StopReason::ToolUse,
        "length" => StopReason::MaxTokens,
        other => StopReason::Other(other.to_string()),
    }
}

pub fn chunk_usage_to_usage(usage: &ChunkUsage) -> Usage {
    Usage {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(json: &str) -> ChatCompletionChunk {
        serde_json::from_str(json).expect("parse chunk")
    }

    #[test]
    fn text_part_from_content() {
        let events = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}"#,
        ));
        assert!(matches!(
            events.first(),
            Some(ModelStreamEvent::TextPart { block_index: 0, .. })
        ));
    }

    #[test]
    fn thinking_part_from_reasoning_content() {
        let events = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}"#,
        ));
        assert!(matches!(
            events.first(),
            Some(ModelStreamEvent::ThinkingPart { block_index: 0, .. })
        ));
    }

    #[test]
    fn tool_call_arguments_merge_before_finished() {
        let mut decoder = StreamDecoder::new();
        let d1 = decoder
            .decode_chunk(&chunk(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":""}}]},"finish_reason":null}]}"#,
            ))
            .expect("d1");
        assert!(matches!(
            d1.first(),
            Some(ModelStreamEvent::ToolUseStarted { .. })
        ));

        let d2 = decoder
            .decode_chunk(&chunk(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"a\""}}]},"finish_reason":null}]}"#,
            ))
            .expect("d2");
        assert!(matches!(
            d2.first(),
            Some(ModelStreamEvent::ToolUsePart { .. })
        ));

        let d3 = decoder
            .decode_chunk(&chunk(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]},"finish_reason":"tool_calls"}]}"#,
            ))
            .expect("d3");
        assert!(d3
            .iter()
            .any(|e| matches!(e, ModelStreamEvent::ToolUseFinished { .. })));
        assert!(matches!(d3.last(), Some(ModelStreamEvent::Finished { .. })));
    }

    #[test]
    fn finish_reason_marks_message_end_emitted() {
        let mut decoder = StreamDecoder::new();
        decoder
            .decode_chunk(&chunk(
                r#"{"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}"#,
            ))
            .expect("chunk");
        assert!(!decoder.has_emitted_message_end());
        decoder
            .decode_chunk(&chunk(
                r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
            ))
            .expect("finish");
        assert!(decoder.has_emitted_message_end());
    }

    #[test]
    fn finished_maps_stop_reason() {
        let events = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
        ));
        assert!(matches!(
            events.last(),
            Some(ModelStreamEvent::Finished {
                stop_reason: StopReason::MaxTokens,
                ..
            })
        ));
    }

    #[test]
    fn map_finish_reason_tool_calls() {
        assert_eq!(map_finish_reason("tool_calls"), StopReason::ToolUse);
    }

    #[test]
    fn usage_on_final_chunk() {
        let events = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":5}}"#,
        ));
        assert!(matches!(
            events.last(),
            Some(ModelStreamEvent::Finished {
                usage: Some(Usage {
                    input_tokens: 3,
                    output_tokens: 5,
                }),
                ..
            })
        ));
    }
}
