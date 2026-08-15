use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::llm::protocol::{ContentBlock, PendingBlock, ToolResultContent};

use super::run_event::RunEvent;
use super::trace_context::TraceContext;

/// Maximum serialized size of a persisted Agent Event JSONL line.
pub const MAX_AGENT_EVENT_BYTES: usize = 64 * 1024;

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

/// Agent Event Log row (pre-persist); `seq` is assigned by the writer.
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

/// Maps a `RunEvent` to an Agent Event Log record, or `None` when the event
/// produces no persisted observation.
pub fn derive_agent_event(ctx: &TraceContext, event: &RunEvent) -> Option<AgentEventRecord> {
    let (turn, phase, channel, kind, payload, preview) = match event {
        RunEvent::RunStarted { run_id, session_id } => (
            ctx.turn,
            AgentPhase::PreLlm,
            AgentChannel::Trace,
            "run_started".to_string(),
            json!({ "runId": run_id, "sessionId": session_id }),
            None,
        ),
        RunEvent::RunEnded { run_id } => (
            ctx.turn,
            AgentPhase::Stop,
            AgentChannel::Trace,
            "run_ended".to_string(),
            json!({ "runId": run_id }),
            None,
        ),
        RunEvent::TurnStarted { turn } => (
            *turn,
            AgentPhase::PreLlm,
            AgentChannel::Trace,
            "turn_started".to_string(),
            json!({ "turn": turn }),
            None,
        ),
        RunEvent::TurnEnded { turn } => (
            *turn,
            AgentPhase::Stop,
            AgentChannel::Trace,
            "turn_ended".to_string(),
            json!({ "turn": turn }),
            None,
        ),
        RunEvent::UserPromptCommitted { turn, text } => (
            *turn,
            AgentPhase::PreLlm,
            AgentChannel::Conversation,
            "user_prompt".to_string(),
            json!({ "text": text }),
            Some(truncate_preview(text, 120)),
        ),
        RunEvent::AssistantFinalized { turn, blocks } => {
            let text = blocks_text(blocks);
            (
                *turn,
                AgentPhase::PostLlm,
                AgentChannel::Conversation,
                "final".to_string(),
                json!({ "text": &text }),
                Some(truncate_preview(&text, 120)),
            )
        }
        RunEvent::ToolInvocationRecorded {
            turn,
            tool_use_id,
            name,
            input,
        } => {
            let input_str = serde_json::to_string(input).unwrap_or_else(|_| "{}".to_string());
            (
                *turn,
                AgentPhase::PostTool,
                AgentChannel::Trace,
                "tool_use".to_string(),
                json!({
                    "toolName": name,
                    "toolUseId": tool_use_id,
                    "charCount": input_str.len(),
                    "input": input,
                }),
                Some(name.clone()),
            )
        }
        RunEvent::ToolOutcomeRecorded {
            turn,
            tool_use_id,
            content,
        } => {
            let body = tool_result_body(content);
            let char_count = body.chars().count();
            (
                *turn,
                AgentPhase::PostTool,
                AgentChannel::Trace,
                "tool_result".to_string(),
                json!({
                    "toolUseId": tool_use_id,
                    "body": &body,
                    "charCount": char_count,
                }),
                Some(truncate_preview(&body, 120)),
            )
        }
        RunEvent::LlmCallStarted {
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
        RunEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            stop_reason,
            usage,
        } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "llm_call".to_string(),
            json!({
                "llmCallId": llm_call_id,
                "step": step,
                "status": "ended",
                "stopReason": stop_reason,
                "usage": usage,
            }),
            None,
        ),
        RunEvent::MessageUpdate {
            turn,
            step,
            llm_call_id,
            snapshot,
        } => message_update_mapping(*turn, *step, llm_call_id, snapshot)?,
        RunEvent::CompactionApplied {
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
        RunEvent::CompactionRecommended { turn } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Context,
            "context_compact".to_string(),
            json!({ "turn": turn, "recommended": true }),
            None,
        ),
        RunEvent::ContextPreflightEnded { turn } => (
            *turn,
            AgentPhase::PreLlm,
            AgentChannel::Context,
            "metrics_pre".to_string(),
            json!({ "report": {} }),
            None,
        ),
        RunEvent::ContextPostflightEnded { turn } => (
            *turn,
            AgentPhase::PostLlm,
            AgentChannel::Context,
            "metrics_post".to_string(),
            json!({ "report": {} }),
            None,
        ),
    };

    Some(AgentEventRecord {
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
    })
}

fn message_update_mapping(
    turn: u64,
    step: u32,
    llm_call_id: &str,
    snapshot: &crate::llm::protocol::ModelResponseSnapshot,
) -> Option<(u64, AgentPhase, AgentChannel, String, Value, Option<String>)> {
    if let Some(pending) = &snapshot.pending {
        return Some(match pending {
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
                (
                    turn,
                    AgentPhase::PostLlm,
                    AgentChannel::Trace,
                    "tool_use".to_string(),
                    json!({
                        "toolName": name,
                        "toolUseId": id,
                        "charCount": input_json.len(),
                        "input": input,
                        "llmCallId": llm_call_id,
                        "step": step,
                    }),
                    Some(name.clone()),
                )
            }
        });
    }

    let last = snapshot.content.last()?;
    match last {
        ContentBlock::Text { text } => Some((
            turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "assistant_text".to_string(),
            json!({ "body": text, "charCount": text.chars().count(), "llmCallId": llm_call_id, "step": step }),
            Some(truncate_preview(text, 120)),
        )),
        ContentBlock::Thinking { thinking } => Some((
            turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "thinking".to_string(),
            json!({ "body": thinking, "charCount": thinking.chars().count(), "llmCallId": llm_call_id, "step": step }),
            Some(truncate_preview(thinking, 120)),
        )),
        ContentBlock::ToolUse { id, name, input } => Some((
            turn,
            AgentPhase::PostLlm,
            AgentChannel::Trace,
            "tool_use".to_string(),
            json!({
                "toolName": name,
                "toolUseId": id,
                "charCount": serde_json::to_string(input).map(|s| s.len()).unwrap_or(0),
                "input": input,
                "llmCallId": llm_call_id,
                "step": step,
            }),
            Some(name.clone()),
        )),
        ContentBlock::ToolResult { .. } => None,
    }
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

fn tool_result_body(content: &ToolResultContent) -> String {
    match content {
        ToolResultContent::Text(text) => text.clone(),
        ToolResultContent::Blocks(blocks) => blocks_text(blocks),
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

/// Applies the 64 KiB persistence limit, truncating large payload strings when needed.
pub fn truncate_record(mut record: AgentEventRecord) -> AgentEventRecord {
    let Ok(mut bytes) = serde_json::to_vec(&record) else {
        return record;
    };
    if bytes.len() <= MAX_AGENT_EVENT_BYTES {
        return record;
    }

    let original_bytes = bytes.len() as u64;
    record.truncated = Some(true);
    record.original_bytes = Some(original_bytes);
    truncate_value_strings(&mut record.payload, MAX_AGENT_EVENT_BYTES / 4);

    if let Ok(reencoded) = serde_json::to_vec(&record) {
        bytes = reencoded;
    }
    if bytes.len() > MAX_AGENT_EVENT_BYTES {
        record.payload = json!({ "truncated": true });
        if let Ok(replaced) = serde_json::to_vec(&record) {
            bytes = replaced;
        }
    }

    if bytes.len() > MAX_AGENT_EVENT_BYTES {
        record.preview = None;
    }

    record
}

fn truncate_value_strings(value: &mut Value, max_string_bytes: usize) {
    match value {
        Value::String(s) => {
            if s.len() > max_string_bytes {
                let mut end = max_string_bytes.min(s.len());
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                *s = format!("{}…", &s[..end]);
            }
        }
        Value::Array(items) => {
            for item in items {
                truncate_value_strings(item, max_string_bytes);
            }
        }
        Value::Object(map) => {
            for v in map.values_mut() {
                truncate_value_strings(v, max_string_bytes);
            }
        }
        _ => {}
    }
}

/// Built-in observe handler that derives and truncates Agent Event records.
///
/// The writer receives records ready for JSONL append (`seq` still unset).
pub struct DeriveObserveHandler<W> {
    writer: W,
}

impl<W> DeriveObserveHandler<W>
where
    W: AgentEventWriter,
{
    pub fn new(writer: W) -> Self {
        Self { writer }
    }
}

impl<W> super::registry::ObserveHandler for DeriveObserveHandler<W>
where
    W: AgentEventWriter,
{
    fn observe(&self, ctx: &TraceContext, event: &RunEvent) -> anyhow::Result<()> {
        if let Some(record) = derive_agent_event(ctx, event) {
            let record = truncate_record(record);
            self.writer.write(record)?;
        }
        Ok(())
    }
}

/// Persists or forwards derived Agent Event records (wired by `agent` in R3).
pub trait AgentEventWriter: Send + Sync {
    fn write(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}
