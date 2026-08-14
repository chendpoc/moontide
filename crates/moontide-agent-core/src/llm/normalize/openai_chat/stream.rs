use std::collections::HashMap;

use serde::Deserialize;

use crate::llm::protocol::{StopReason, StreamDelta, Usage};

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

/// Stateful decoder: merges fragmented tool `arguments` before [`StreamDelta::ToolUseEnd`].
#[derive(Debug, Default)]
pub struct StreamDecoder {
    tool_calls: HashMap<u32, ToolCallState>,
    finished: bool,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn decode_chunk(&mut self, chunk: &ChatCompletionChunk) -> Vec<StreamDelta> {
        if self.finished {
            return Vec::new();
        }

        let mut deltas = Vec::new();
        for choice in &chunk.choices {
            if !choice.delta.tool_calls.is_empty() {
                for tool_delta in &choice.delta.tool_calls {
                    deltas.extend(self.apply_tool_delta(tool_delta));
                }
            } else {
                deltas.extend(split_assistant_text(
                    choice.delta.content.as_deref(),
                    choice.delta.reasoning_content.as_deref(),
                ));
            }

            if let Some(reason) = choice.finish_reason.as_deref() {
                let usage = chunk.usage.as_ref().map(chunk_usage_to_usage);
                deltas.extend(self.finish(reason, usage));
            }
        }

        deltas
    }

    fn apply_tool_delta(&mut self, tool_delta: &ToolCallDelta) -> Vec<StreamDelta> {
        let mut deltas = Vec::new();
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
                    deltas.push(StreamDelta::ToolUseDelta {
                        id: entry.id.clone(),
                        input_json_delta: args.clone(),
                    });
                }
            }
        }

        if !entry.started && !entry.id.is_empty() && !entry.name.is_empty() {
            entry.started = true;
            deltas.push(StreamDelta::ToolUseStart {
                id: entry.id.clone(),
                name: entry.name.clone(),
            });
            if !entry.arguments.is_empty() {
                deltas.push(StreamDelta::ToolUseDelta {
                    id: entry.id.clone(),
                    input_json_delta: entry.arguments.clone(),
                });
            }
        }

        deltas
    }

    fn finish(&mut self, finish_reason: &str, usage: Option<Usage>) -> Vec<StreamDelta> {
        let mut deltas = Vec::new();

        if finish_reason == "tool_calls" || finish_reason == "stop" {
            for state in self.tool_calls.values() {
                if state.started {
                    deltas.push(StreamDelta::ToolUseEnd {
                        id: state.id.clone(),
                    });
                }
            }
            self.tool_calls.clear();
        }

        deltas.push(StreamDelta::MessageEnd {
            stop_reason: map_finish_reason(finish_reason),
            usage,
        });
        self.finished = true;
        deltas
    }
}

pub fn decode_stream_chunk(chunk: &ChatCompletionChunk) -> Vec<StreamDelta> {
    let mut decoder = StreamDecoder::new();
    decoder.decode_chunk(chunk)
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
    fn text_delta_from_content() {
        let deltas = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}"#,
        ));
        assert!(matches!(deltas.first(), Some(StreamDelta::TextDelta { .. })));
    }

    #[test]
    fn reasoning_delta_from_reasoning_content() {
        let deltas = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}"#,
        ));
        assert!(matches!(deltas.first(), Some(StreamDelta::ThinkingDelta { .. })));
    }

    #[test]
    fn tool_call_arguments_merge_before_end() {
        let mut decoder = StreamDecoder::new();
        let d1 = decoder.decode_chunk(&chunk(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":""}}]},"finish_reason":null}]}"#,
        ));
        assert!(matches!(d1.first(), Some(StreamDelta::ToolUseStart { .. })));

        let d2 = decoder.decode_chunk(&chunk(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"a\""}}]},"finish_reason":null}]}"#,
        ));
        assert!(matches!(d2.first(), Some(StreamDelta::ToolUseDelta { .. })));

        let d3 = decoder.decode_chunk(&chunk(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]},"finish_reason":"tool_calls"}]}"#,
        ));
        assert!(d3.iter().any(|d| matches!(d, StreamDelta::ToolUseEnd { .. })));
        assert!(matches!(d3.last(), Some(StreamDelta::MessageEnd { .. })));
    }

    #[test]
    fn message_end_maps_stop_reason() {
        let deltas = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
        ));
        assert!(matches!(
            deltas.last(),
            Some(StreamDelta::MessageEnd {
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
        let deltas = decode_stream_chunk(&chunk(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":5}}"#,
        ));
        assert!(matches!(
            deltas.last(),
            Some(StreamDelta::MessageEnd {
                usage: Some(Usage {
                    input_tokens: 3,
                    output_tokens: 5,
                }),
                ..
            })
        ));
    }
}
