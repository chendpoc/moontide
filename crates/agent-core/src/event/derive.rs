use anyhow::{
    Context,
    Result,
};
use chrono::Utc;
use serde::{
    Deserialize,
    Serialize,
};
use serde_json::{
    Value,
    json,
};
use uuid::Uuid;

use super::trace_context::TraceContext;
use super::turn_event::TurnEvent;
use crate::llm::protocol::{
    ContentBlock,
    PendingBlock,
};
use crate::tools::{
    ToolCall,
    ToolContent,
    ToolResult,
    ToolResultStatus,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentPhase {
    PreLlm,
    PostLlm,
    PostTool,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentChannel {
    Conversation,
    Trace,
    Context,
    #[serde(rename = "tool_use_log")]
    ToolUseLog,
}

/// Agent Event Log row (pre-persist); `seq` is assigned by the recorder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentEventRecord {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(rename = "runId")]
    pub run_id: String,
    pub turn: u64,
    pub phase: AgentPhase,
    pub channel: AgentChannel,
    pub kind: String,
    pub ts: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    #[serde(rename = "originalBytes", skip_serializing_if = "Option::is_none")]
    pub original_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCallTracePayload<'a> {
    tool_name: &'a str,
    tool_use_id: &'a str,
    char_count: usize,
    input: &'a Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolUseUpdateTracePayload<'a> {
    tool_name: &'a str,
    tool_use_id: &'a str,
    char_count: usize,
    input: &'a Value,
    llm_call_id: &'a str,
    step: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolResultTracePayload<'a> {
    tool_name: &'a str,
    tool_use_id: &'a str,
    status: &'a ToolResultStatus,
    content: &'a ToolContent,
    body: &'a str,
    char_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantFinalizedTracePayload<'a> {
    llm_call_id: &'a str,
    blocks: &'a [ContentBlock],
    text: &'a str,
}

type EventMapping = (u64, AgentPhase, AgentChannel, String, Value, Option<String>);

/// Maps a `TurnEvent` to an Agent Event Log record, or `None` when the event
/// produces no persisted observation. Serialization failures are returned to
/// the observe boundary instead of being replaced with fabricated payloads.
pub fn derive_agent_event(
    ctx: &TraceContext,
    event: &TurnEvent,
) -> Result<Option<AgentEventRecord>> {
    let (turn, phase, channel, kind, payload, preview) = match event {
        TurnEvent::TurnStarted { turn } => (
            *turn,
            AgentPhase::PreLlm,
            AgentChannel::Trace,
            "turn_started".to_string(),
            json!({ "turn": turn }),
            None,
        ),
        TurnEvent::TurnEnded { turn } => (
            *turn,
            AgentPhase::Stop,
            AgentChannel::Trace,
            "turn_ended".to_string(),
            json!({ "turn": turn }),
            None,
        ),
        TurnEvent::UserPromptCommitted { turn, text } => (
            *turn,
            AgentPhase::PreLlm,
            AgentChannel::Conversation,
            "user_prompt".to_string(),
            json!({ "text": text }),
            Some(truncate_preview(text, 120)),
        ),
        TurnEvent::AssistantFinalized {
            turn,
            llm_call_id,
            blocks,
        } => {
            let text = blocks_text(blocks);
            let payload = serde_json::to_value(AssistantFinalizedTracePayload {
                llm_call_id,
                blocks,
                text: &text,
            })
            .context("serialize assistant finalized trace payload")?;
            (
                *turn,
                AgentPhase::PostLlm,
                AgentChannel::Conversation,
                "final".to_string(),
                payload,
                Some(truncate_preview(&text, 120)),
            )
        }
        TurnEvent::ToolCallRecorded { turn, call } => {
            let payload = tool_call_trace_payload(call)?;
            (
                *turn,
                AgentPhase::PostTool,
                AgentChannel::Trace,
                "tool_use".to_string(),
                payload,
                Some(call.name().to_owned()),
            )
        }
        TurnEvent::ToolResultRecorded { turn, result } => {
            let (payload, body) = tool_result_trace_payload(result)?;
            (
                *turn,
                AgentPhase::PostTool,
                AgentChannel::Trace,
                "tool_result".to_string(),
                payload,
                Some(truncate_preview(&body, 120)),
            )
        }
        TurnEvent::LlmCallStarted {
            turn,
            step,
            llm_call_id,
        } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "llm_call".to_string(),
            json!({
                "llmCallId": llm_call_id,
                "step": step,
                "status": "started",
            }),
            None,
        ),
        TurnEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            outcome,
        } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "llm_call".to_string(),
            json!({
                "llmCallId": llm_call_id,
                "step": step,
                "status": "ended",
                "outcome": outcome,
            }),
            None,
        ),
        TurnEvent::MessageUpdate {
            turn,
            step,
            llm_call_id,
            snapshot,
        } => match message_update_mapping(*turn, *step, llm_call_id, snapshot)? {
            Some(mapping) => mapping,
            None => return Ok(None),
        },
        TurnEvent::CompactionApplied {
            turn,
            compaction_kind,
            compaction_save_id,
            excluded_item_ids,
            before_tokens,
            after_tokens,
        } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Context,
            "context_compact".to_string(),
            json!({
                "turn": turn,
                "applied": true,
                "compactionKind": compaction_kind,
                "compactionSaveId": compaction_save_id,
                "excludedItemIds": excluded_item_ids,
                "beforeTokens": before_tokens,
                "afterTokens": after_tokens,
            }),
            None,
        ),
        TurnEvent::CompactionRecommended { turn } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Context,
            "context_compact".to_string(),
            json!({ "turn": turn, "recommended": true }),
            None,
        ),
        TurnEvent::ContextPreflightEnded { turn } => (
            *turn,
            AgentPhase::PreLlm,
            AgentChannel::Context,
            "metrics_pre".to_string(),
            json!({ "report": {} }),
            None,
        ),
        TurnEvent::ContextPostflightEnded { turn } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Context,
            "metrics_post".to_string(),
            json!({ "report": {} }),
            None,
        ),
    };

    Ok(Some(AgentEventRecord {
        id: Uuid::new_v4().to_string(),
        seq: None,
        run_id: ctx.run_id.clone(),
        turn,
        phase,
        channel,
        kind,
        ts: Utc::now().timestamp_millis(),
        payload,
        preview,
        truncated: None,
        original_bytes: None,
    }))
}

fn message_update_mapping(
    turn: u64,
    step: u32,
    llm_call_id: &str,
    snapshot: &crate::llm::protocol::ModelResponseSnapshot,
) -> Result<Option<EventMapping>> {
    if let Some(pending) = &snapshot.pending {
        let mapping = match pending {
            PendingBlock::Text { text } => (
                turn,
                AgentPhase::PostLlm,
                AgentChannel::Trace,
                "assistant_text".to_string(),
                json!({ "body": text, "charCount": text.chars().count(), "llmCallId": llm_call_id, "step": step }),
                Some(truncate_preview(text, 120)),
            ),
            PendingBlock::Thinking { thinking } => (
                turn,
                AgentPhase::PostLlm,
                AgentChannel::Trace,
                "thinking".to_string(),
                json!({ "body": thinking, "charCount": thinking.chars().count(), "llmCallId": llm_call_id, "step": step }),
                Some(truncate_preview(thinking, 120)),
            ),
            PendingBlock::ToolUse {
                id,
                name,
                input_json,
            } => {
                let input = serde_json::from_str(input_json)
                    .unwrap_or_else(|_| Value::String(input_json.clone()));
                let persisted_input = serde_json::to_string(&input)
                    .context("serialize pending tool use update input")?;
                let payload = serde_json::to_value(ToolUseUpdateTracePayload {
                    tool_name: name,
                    tool_use_id: id,
                    char_count: persisted_input.chars().count(),
                    input: &input,
                    llm_call_id,
                    step,
                })
                .context("serialize pending tool use update payload")?;
                (
                    turn,
                    AgentPhase::PostLlm,
                    AgentChannel::Trace,
                    "tool_use_update".to_string(),
                    payload,
                    Some(name.clone()),
                )
            }
        };
        return with_snapshot(Some(mapping), snapshot);
    }

    let Some(last) = snapshot.content.last() else {
        return Ok(None);
    };
    let mapping = match last {
        ContentBlock::Text { text } => (
            turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "assistant_text".to_string(),
            json!({ "body": text, "charCount": text.chars().count(), "llmCallId": llm_call_id, "step": step }),
            Some(truncate_preview(text, 120)),
        ),
        ContentBlock::Thinking { thinking } => (
            turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "thinking".to_string(),
            json!({ "body": thinking, "charCount": thinking.chars().count(), "llmCallId": llm_call_id, "step": step }),
            Some(truncate_preview(thinking, 120)),
        ),
        ContentBlock::ToolUse { id, name, input } => {
            let input_json = serde_json::to_string(input)
                .context("serialize completed tool use update input")?;
            let payload = serde_json::to_value(ToolUseUpdateTracePayload {
                tool_name: name,
                tool_use_id: id,
                char_count: input_json.chars().count(),
                input,
                llm_call_id,
                step,
            })
            .context("serialize completed tool use update payload")?;
            (
                turn,
                AgentPhase::PostLlm,
                AgentChannel::Trace,
                "tool_use_update".to_string(),
                payload,
                Some(name.clone()),
            )
        }
        ContentBlock::ToolResult { .. } => return Ok(None),
    };
    with_snapshot(Some(mapping), snapshot)
}

fn with_snapshot(
    mapping: Option<EventMapping>,
    snapshot: &crate::llm::protocol::ModelResponseSnapshot,
) -> Result<Option<EventMapping>> {
    let Some((turn, phase, channel, kind, mut payload, preview)) = mapping else {
        return Ok(None);
    };
    let object = payload
        .as_object_mut()
        .context("serialize message update trace payload as object")?;
    object.insert(
        "snapshot".to_owned(),
        serde_json::to_value(snapshot).context("serialize message update snapshot")?,
    );
    Ok(Some((turn, phase, channel, kind, payload, preview)))
}

fn blocks_text(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn tool_call_trace_payload(call: &ToolCall) -> Result<Value> {
    let input_json =
        serde_json::to_string(call.input()).context("serialize committed tool call input")?;
    serde_json::to_value(ToolCallTracePayload {
        tool_name: call.name(),
        tool_use_id: call.tool_use_id(),
        char_count: input_json.chars().count(),
        input: call.input(),
    })
    .context("serialize committed tool call trace payload")
}

fn tool_result_trace_payload(result: &ToolResult) -> Result<(Value, String)> {
    let body = tool_result_body(result.content())?;
    let payload = serde_json::to_value(ToolResultTracePayload {
        tool_name: result.name(),
        tool_use_id: result.tool_use_id(),
        status: result.status(),
        content: result.content(),
        body: &body,
        char_count: body.chars().count(),
    })
    .context("serialize committed tool result trace payload")?;
    Ok((payload, body))
}

fn tool_result_body(content: &ToolContent) -> Result<String> {
    match content {
        ToolContent::Text(text) => Ok(text.clone()),
        ToolContent::Json(value) => {
            serde_json::to_string(value).context("serialize tool result trace body")
        }
    }
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_chars).collect();
    format!("{truncated}…")
}
