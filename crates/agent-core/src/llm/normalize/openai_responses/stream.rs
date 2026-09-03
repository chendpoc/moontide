use std::collections::BTreeMap;

use serde_json::Value;

use super::ResponsesStreamEvent;
use crate::llm::profile_config::WireProfileConfig;
use crate::llm::protocol::{
    LlmError,
    ModelStreamEvent,
    RequestFailureKind,
    StopReason,
    Usage,
};

/// Wire decode paths resolved from [`WireProfileConfig`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponsesDecodeConfig {
    pub text_delta_event: String,
    pub reasoning_delta_event: Option<String>,
}

impl Default for ResponsesDecodeConfig {
    fn default() -> Self {
        Self {
            text_delta_event: "response.output_text.delta".into(),
            reasoning_delta_event: None,
        }
    }
}

impl ResponsesDecodeConfig {
    pub fn from_wire(wire: &WireProfileConfig) -> Self {
        let text_delta_event = wire
            .decode
            .output_text_path
            .as_ref()
            .map(|path| format!("response.{path}.delta"))
            .unwrap_or_else(|| "response.output_text.delta".into());
        let reasoning_delta_event = wire
            .decode
            .reasoning_delta_field
            .as_ref()
            .map(|field| format!("response.{field}.delta"));
        Self {
            text_delta_event,
            reasoning_delta_event,
        }
    }
}

#[derive(Debug)]
struct ToolCallState {
    id: String,
    name: String,
    arguments: String,
    started: bool,
}

/// Stateful decoder for OpenAI Responses semantic SSE events.
#[derive(Debug, Default)]
pub struct StreamDecoder {
    config: ResponsesDecodeConfig,
    tool_calls: BTreeMap<String, ToolCallState>,
    message_end_emitted: bool,
    response_id: Option<String>,
    had_reasoning: bool,
}

impl StreamDecoder {
    pub fn with_config(config: ResponsesDecodeConfig) -> Self {
        Self {
            config,
            ..Self::default()
        }
    }

    pub fn has_emitted_message_end(&self) -> bool {
        self.message_end_emitted
    }

    pub fn decode_event(
        &mut self,
        event: &ResponsesStreamEvent,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        if self.message_end_emitted {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();
        match event.event_type.as_str() {
            t if t == self.config.text_delta_event => {
                if let Some(delta) = event.delta.as_deref() {
                    if !delta.is_empty() {
                        let block_index = u32::from(self.had_reasoning);
                        events.push(ModelStreamEvent::TextPart {
                            block_index,
                            text: delta.to_string(),
                        });
                    }
                }
            }
            "response.output_item.added" => {
                events.extend(self.handle_output_item_added(event)?);
            }
            "response.function_call_arguments.delta" => {
                events.extend(self.handle_function_arguments_delta(event)?);
            }
            "response.function_call_arguments.done" => {
                events.extend(self.handle_function_arguments_done(event)?);
            }
            "response.completed" => {
                if let Some(response) = &event.response {
                    self.response_id = response.id.clone();
                    let usage = response.usage.as_ref().map(|u| Usage {
                        input_tokens: u.input_tokens.unwrap_or(0),
                        output_tokens: u.output_tokens.unwrap_or(0),
                    });
                    let stop_reason = map_response_status(response.status.as_deref());
                    events.push(ModelStreamEvent::Finished {
                        stop_reason,
                        usage,
                        response_id: self.response_id.clone(),
                    });
                    self.message_end_emitted = true;
                }
            }
            "response.failed" | "error" => {
                return Err(LlmError::RequestFailed {
                    kind: RequestFailureKind::Unrecoverable,
                    message: format!("responses stream error event: {}", event.event_type),
                });
            }
            other => {
                if self
                    .config
                    .reasoning_delta_event
                    .as_deref()
                    .is_some_and(|reasoning| other == reasoning)
                {
                    if let Some(delta) = event.delta.as_deref() {
                        if !delta.is_empty() {
                            self.had_reasoning = true;
                            events.push(ModelStreamEvent::ThinkingPart {
                                block_index: 0,
                                thinking: delta.to_string(),
                            });
                        }
                    }
                }
            }
        }

        Ok(events)
    }

    fn handle_output_item_added(
        &mut self,
        event: &ResponsesStreamEvent,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        let mut events = Vec::new();
        let Some(item) = &event.item else {
            return Ok(events);
        };
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
        if item_type != "function_call" {
            return Ok(events);
        }
        let id = item
            .get("call_id")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if id.is_empty() || name.is_empty() {
            return Ok(events);
        }
        self.tool_calls.insert(
            id.clone(),
            ToolCallState {
                id: id.clone(),
                name: name.clone(),
                arguments: String::new(),
                started: false,
            },
        );
        if let Some(entry) = self.tool_calls.get_mut(&id) {
            entry.started = true;
        }
        events.push(ModelStreamEvent::ToolUseStarted { id, name });
        Ok(events)
    }

    fn handle_function_arguments_delta(
        &mut self,
        event: &ResponsesStreamEvent,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        let mut events = Vec::new();
        let Some(item_id) = event.item_id.as_deref() else {
            return Ok(events);
        };
        let Some(delta) = event.delta.as_deref() else {
            return Ok(events);
        };
        if delta.is_empty() {
            return Ok(events);
        }
        let entry = self
            .tool_calls
            .entry(item_id.to_string())
            .or_insert_with(|| ToolCallState {
                id: item_id.to_string(),
                name: String::new(),
                arguments: String::new(),
                started: false,
            });
        entry.arguments.push_str(delta);
        if entry.started {
            events.push(ModelStreamEvent::ToolUsePart {
                id: entry.id.clone(),
                input_json: delta.to_string(),
            });
        }
        Ok(events)
    }

    fn handle_function_arguments_done(
        &mut self,
        event: &ResponsesStreamEvent,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        let mut events = Vec::new();
        let Some(item_id) = event.item_id.as_deref() else {
            return Ok(events);
        };
        let entry = match self.tool_calls.get_mut(item_id) {
            Some(entry) => entry,
            None => return Ok(events),
        };
        if let Some(args) = event.arguments.as_deref() {
            entry.arguments = args.to_string();
        }
        let input = parse_tool_input(&entry.arguments)?;
        let name = entry.name.clone();
        if name.is_empty() {
            if let Some(n) = name_from_item(event) {
                entry.name = n;
            }
        }
        let name = entry.name.clone();
        if !name.is_empty() {
            events.push(ModelStreamEvent::ToolUseFinished {
                id: entry.id.clone(),
                name,
                input,
            });
            entry.started = true;
        }
        Ok(events)
    }
}

fn name_from_item(event: &ResponsesStreamEvent) -> Option<String> {
    event
        .item
        .as_ref()
        .and_then(|item| item.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string)
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

fn map_response_status(status: Option<&str>) -> StopReason {
    match status {
        Some("completed") | Some("incomplete") | None => StopReason::EndTurn,
        Some("failed") => StopReason::Other("failed".into()),
        Some(other) => StopReason::Other(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::normalize::openai_responses::ResponsesDecodeConfig;

    // Scenario: standard OpenAI Responses text delta events arrive before completion.
    // Expected: text parts stream and completion carries response_id.
    // Invariant: Finished includes the provider response id for continuity sidecars.
    #[test]
    fn text_delta_and_completed_emit_response_id() {
        let mut decoder = StreamDecoder::with_config(ResponsesDecodeConfig {
            text_delta_event: "response.output_text.delta".into(),
            reasoning_delta_event: None,
        });
        let text = decoder
            .decode_event(
                &serde_json::from_str(r#"{"type":"response.output_text.delta","delta":"hi"}"#)
                    .expect("event"),
            )
            .expect("text");
        assert!(matches!(
            text.first(),
            Some(ModelStreamEvent::TextPart { .. })
        ));

        let finished = decoder
            .decode_event(&serde_json::from_str(
                r#"{"type":"response.completed","response":{"id":"resp_123","status":"completed","usage":{"input_tokens":1,"output_tokens":2}}}"#,
            )
            .expect("event"))
            .expect("finished");
        assert!(matches!(
            finished.last(),
            Some(ModelStreamEvent::Finished {
                response_id: Some(id),
                ..
            }) if id == "resp_123"
        ));
    }

    // Scenario: DeepSeek profile sets reasoning_text as the reasoning delta field.
    // Expected: reasoning deltas map to ThinkingPart events.
    // Invariant: reasoning block index stays at zero before visible text.
    #[test]
    fn deepseek_reasoning_delta_maps_to_thinking_part() {
        let mut decoder = StreamDecoder::with_config(ResponsesDecodeConfig {
            text_delta_event: "response.output_text.delta".into(),
            reasoning_delta_event: Some("response.reasoning_text.delta".into()),
        });
        let events = decoder
            .decode_event(
                &serde_json::from_str(
                    r#"{"type":"response.reasoning_text.delta","delta":"trace"}"#,
                )
                .expect("event"),
            )
            .expect("decode");
        assert!(matches!(
            events.first(),
            Some(ModelStreamEvent::ThinkingPart { .. })
        ));
    }

    // Scenario: Agnes profile sets output_items as the text delta path.
    // Expected: output_items delta events map to TextPart.
    // Invariant: custom decode paths do not require separate adapter code.
    #[test]
    fn agnes_output_items_delta_maps_to_text_part() {
        let mut decoder = StreamDecoder::with_config(ResponsesDecodeConfig {
            text_delta_event: "response.output_items.delta".into(),
            reasoning_delta_event: None,
        });
        let events = decoder
            .decode_event(
                &serde_json::from_str(r#"{"type":"response.output_items.delta","delta":"chunk"}"#)
                    .expect("event"),
            )
            .expect("decode");
        assert!(matches!(
            events.first(),
            Some(ModelStreamEvent::TextPart { text, .. }) if text == "chunk"
        ));
        let _ = events;
    }
}
