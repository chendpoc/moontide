use std::pin::Pin;

use futures::Stream;
use futures::StreamExt;

use crate::llm::protocol::{
    ContentBlock, LlmError, ModelRequest, ModelResponse, StreamDelta,
};

/// Streaming LLM port. Implementations must emit exactly one [`StreamDelta::MessageEnd`] last on success.
pub trait LLMProvider: Send + Sync {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<StreamDelta, LlmError>> + Send + '_>>;
}

/// Collect a stream into a [`ModelResponse`].
pub async fn complete(
    provider: &dyn LLMProvider,
    request: ModelRequest,
) -> Result<ModelResponse, LlmError> {
    let model = Some(request.model.clone());
    let mut stream = provider.stream(request);
    let mut content: Vec<ContentBlock> = Vec::new();
    let mut pending_text = String::new();
    let mut pending_thinking = String::new();
    let mut tool_inputs: Vec<(String, String, String)> = Vec::new();
    let mut stop_reason = None;
    let mut usage = None;

    while let Some(item) = stream.next().await {
        match item? {
            StreamDelta::TextDelta { text } => pending_text.push_str(&text),
            StreamDelta::ThinkingDelta { thinking } => pending_thinking.push_str(&thinking),
            StreamDelta::ToolUseStart { id, name } => {
                flush_text(&mut content, &mut pending_text);
                flush_thinking(&mut content, &mut pending_thinking);
                tool_inputs.push((id, name, String::new()));
            }
            StreamDelta::ToolUseDelta {
                id,
                input_json_delta,
            } => {
                if let Some(entry) = tool_inputs.iter_mut().find(|(tool_id, _, _)| tool_id == &id)
                {
                    entry.2.push_str(&input_json_delta);
                }
            }
            StreamDelta::ToolUseEnd { id } => {
                if let Some(pos) = tool_inputs.iter().position(|(tool_id, _, _)| tool_id == &id) {
                    let (tool_id, name, input_json) = tool_inputs.remove(pos);
                    let input = serde_json::from_str(&input_json).unwrap_or(serde_json::Value::Null);
                    content.push(ContentBlock::ToolUse {
                        id: tool_id,
                        name,
                        input,
                    });
                }
            }
            StreamDelta::MessageEnd {
                stop_reason: reason,
                usage: u,
            } => {
                flush_text(&mut content, &mut pending_text);
                flush_thinking(&mut content, &mut pending_thinking);
                stop_reason = Some(reason);
                usage = u;
            }
        }
    }

    let stop_reason = stop_reason.ok_or_else(|| LlmError::RequestFailed {
        kind: crate::llm::protocol::RequestFailureKind::Unrecoverable,
        message: "stream ended without MessageEnd".into(),
    })?;

    Ok(ModelResponse {
        content,
        stop_reason,
        usage,
        model,
    })
}

fn flush_text(content: &mut Vec<ContentBlock>, pending: &mut String) {
    if pending.is_empty() {
        return;
    }
    content.push(ContentBlock::Text {
        text: std::mem::take(pending),
    });
}

fn flush_thinking(content: &mut Vec<ContentBlock>, pending: &mut String) {
    if pending.is_empty() {
        return;
    }
    content.push(ContentBlock::Thinking {
        thinking: std::mem::take(pending),
    });
}
