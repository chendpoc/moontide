use serde::Deserialize;
use serde_json::Value;

use crate::llm::protocol::{
    LlmError,
    ModelStreamEvent,
    StopReason,
    Usage,
};

#[derive(Debug, Clone, Deserialize)]
pub struct GeminiStreamChunk {
    #[serde(default)]
    pub candidates: Vec<GeminiCandidate>,
    #[serde(default)]
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GeminiCandidate {
    #[serde(default)]
    pub content: Option<GeminiContent>,
    #[serde(default, rename = "finishReason")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GeminiContent {
    #[serde(default)]
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GeminiPart {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default, rename = "functionCall")]
    pub function_call: Option<GeminiFunctionCall>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GeminiFunctionCall {
    pub name: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GeminiUsageMetadata {
    #[serde(default, rename = "promptTokenCount")]
    pub prompt_token_count: Option<u32>,
    #[serde(default, rename = "candidatesTokenCount")]
    pub candidates_token_count: Option<u32>,
}

#[derive(Debug, Default)]
pub struct StreamDecoder {
    message_end_emitted: bool,
    usage: Option<Usage>,
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
        chunk: &GeminiStreamChunk,
    ) -> Result<Vec<ModelStreamEvent>, LlmError> {
        if self.message_end_emitted {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();
        if let Some(metadata) = &chunk.usage_metadata {
            self.usage = Some(Usage {
                input_tokens: metadata.prompt_token_count.unwrap_or(0),
                output_tokens: metadata.candidates_token_count.unwrap_or(0),
            });
        }

        for candidate in &chunk.candidates {
            if let Some(content) = &candidate.content {
                for part in &content.parts {
                    if let Some(text) = part.text.as_deref()
                        && !text.is_empty()
                    {
                        events.push(ModelStreamEvent::TextPart {
                            block_index: 0,
                            text: text.to_string(),
                        });
                    }
                    if let Some(call) = &part.function_call {
                        let id = format!("call_{}", call.name);
                        events.push(ModelStreamEvent::ToolUseStarted {
                            id: id.clone(),
                            name: call.name.clone(),
                        });
                        events.push(ModelStreamEvent::ToolUseFinished {
                            id,
                            name: call.name.clone(),
                            input: call.args.clone(),
                        });
                    }
                }
            }
            if let Some(reason) = candidate.finish_reason.as_deref()
                && (reason == "STOP" || reason == "MAX_TOKENS")
            {
                let stop_reason = if reason == "MAX_TOKENS" {
                    StopReason::MaxTokens
                } else {
                    StopReason::EndTurn
                };
                events.push(ModelStreamEvent::Finished {
                    stop_reason,
                    usage: self.usage.take(),
                    response_id: None,
                });
                self.message_end_emitted = true;
            }
        }

        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: Gemini SSE chunks stream incremental text then finish with STOP.
    // Expected: TextPart events precede a single Finished terminus.
    // Invariant: finishReason on the final candidate drives stream termination.
    #[test]
    fn text_chunks_finish_on_stop_reason() {
        let mut decoder = StreamDecoder::new();
        let events = decoder
            .decode_chunk(
                &serde_json::from_str(
                    r#"{"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"}}]}"#,
                )
                .expect("chunk"),
            )
            .expect("decode");
        assert!(matches!(
            events.first(),
            Some(ModelStreamEvent::TextPart { .. })
        ));

        let finished = decoder
            .decode_chunk(&serde_json::from_str(
                r#"{"candidates":[{"content":{"parts":[{"text":"!"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2}}"#,
            )
            .expect("chunk"))
            .expect("finish");
        assert!(matches!(
            finished.last(),
            Some(ModelStreamEvent::Finished {
                stop_reason: StopReason::EndTurn,
                ..
            })
        ));
    }
}
