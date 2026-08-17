#![allow(
    dead_code,
    reason = "the higher-level orchestration module will consume this boundary in a later batch"
)]

use std::collections::BTreeMap;

use anyhow::{Context, Result};

use crate::{
    llm::protocol::{ContentBlock, Message, MessageContent, Role, ToolResultContent},
    session::SessionItem,
    tools::{ToolCall, ToolContent, ToolResult},
};

/// Materializes session facts into provider-neutral model messages.
pub(crate) fn materialize(items: &[SessionItem]) -> Result<Vec<Message>> {
    let mut messages = Vec::new();
    let mut phase = Phase::Idle;

    for item in items {
        match item {
            SessionItem::UserMessage { text, .. } => {
                ensure_idle(&phase, "user message")?;
                messages.push(Message {
                    role: Role::User,
                    content: MessageContent::Text(text.clone()),
                });
            }
            SessionItem::AssistantMessage { blocks, .. } => {
                ensure_idle(&phase, "assistant message")?;
                messages.push(Message {
                    role: Role::Assistant,
                    content: MessageContent::Blocks(blocks.clone()),
                });
            }
            SessionItem::ToolCall { call, .. } => {
                phase = append_call(phase, call)?;
            }
            SessionItem::ToolResult { result, .. } => {
                phase = append_result(phase, result, &mut messages)?;
            }
            SessionItem::CheckpointCreated { .. } => {
                // Checkpoints are durable metadata and must not split a call/result round.
            }
            SessionItem::Compaction { .. } => {
                anyhow::bail!("context materialize does not support compaction items in R1");
            }
        }
    }

    match phase {
        Phase::Idle => Ok(messages),
        Phase::Calls { pending, .. } | Phase::Results { pending, .. } => {
            Err(dangling_call_error(&pending))
        }
    }
}

#[derive(Debug)]
enum Phase {
    Idle,
    Calls {
        blocks: Vec<ContentBlock>,
        pending: BTreeMap<String, String>,
    },
    Results {
        blocks: Vec<ContentBlock>,
        pending: BTreeMap<String, String>,
    },
}

fn ensure_idle(phase: &Phase, item_kind: &str) -> Result<()> {
    if matches!(phase, Phase::Idle) {
        return Ok(());
    }

    anyhow::bail!("{item_kind} appeared before the current tool round closed")
}

fn append_call(phase: Phase, call: &ToolCall) -> Result<Phase> {
    match phase {
        Phase::Idle => {
            let mut pending = BTreeMap::new();
            add_pending_call(&mut pending, call)?;
            Ok(Phase::Calls {
                blocks: vec![tool_use_block(call)],
                pending,
            })
        }
        Phase::Calls {
            mut blocks,
            mut pending,
        } => {
            add_pending_call(&mut pending, call)?;
            blocks.push(tool_use_block(call));
            Ok(Phase::Calls { blocks, pending })
        }
        Phase::Results { .. } => {
            anyhow::bail!("tool call appeared before the previous tool result round closed")
        }
    }
}

fn append_result(phase: Phase, result: &ToolResult, messages: &mut Vec<Message>) -> Result<Phase> {
    match phase {
        Phase::Idle => anyhow::bail!(
            "tool result has no preceding tool call: id={}, name={}",
            result.tool_use_id(),
            result.name()
        ),
        Phase::Calls {
            blocks,
            mut pending,
        } => {
            validate_pending_result(&pending, result)?;
            messages.push(Message {
                role: Role::Assistant,
                content: MessageContent::Blocks(blocks),
            });

            pending.remove(result.tool_use_id());
            let result_block = tool_result_block(result)?;
            if pending.is_empty() {
                messages.push(Message {
                    role: Role::User,
                    content: MessageContent::Blocks(vec![result_block]),
                });
                Ok(Phase::Idle)
            } else {
                Ok(Phase::Results {
                    blocks: vec![result_block],
                    pending,
                })
            }
        }
        Phase::Results {
            mut blocks,
            mut pending,
        } => {
            validate_pending_result(&pending, result)?;
            pending.remove(result.tool_use_id());
            blocks.push(tool_result_block(result)?);

            if pending.is_empty() {
                messages.push(Message {
                    role: Role::User,
                    content: MessageContent::Blocks(blocks),
                });
                Ok(Phase::Idle)
            } else {
                Ok(Phase::Results { blocks, pending })
            }
        }
    }
}

fn add_pending_call(pending: &mut BTreeMap<String, String>, call: &ToolCall) -> Result<()> {
    if pending
        .insert(call.tool_use_id().to_owned(), call.name().to_owned())
        .is_some()
    {
        anyhow::bail!(
            "duplicate tool call identity: id={}, name={}",
            call.tool_use_id(),
            call.name()
        );
    }
    Ok(())
}

fn validate_pending_result(pending: &BTreeMap<String, String>, result: &ToolResult) -> Result<()> {
    let call_name = pending.get(result.tool_use_id()).ok_or_else(|| {
        anyhow::anyhow!(
            "tool result has unknown or duplicate tool_use_id: {}",
            result.tool_use_id()
        )
    })?;

    if call_name != result.name() {
        anyhow::bail!(
            "tool result name mismatch for id={}: expected {}, got {}",
            result.tool_use_id(),
            call_name,
            result.name()
        );
    }

    Ok(())
}

fn dangling_call_error(pending: &BTreeMap<String, String>) -> anyhow::Error {
    let pending = pending
        .iter()
        .map(|(tool_use_id, name)| format!("{tool_use_id}/{name}"))
        .collect::<Vec<_>>()
        .join(", ");

    anyhow::anyhow!("dangling tool call round at end of Session Item Log; pending calls: {pending}")
}

fn tool_use_block(call: &ToolCall) -> ContentBlock {
    ContentBlock::ToolUse {
        id: call.tool_use_id().to_owned(),
        name: call.name().to_owned(),
        input: call.input().clone(),
    }
}

fn tool_result_block(result: &ToolResult) -> Result<ContentBlock> {
    let content = match result.content() {
        ToolContent::Text(text) => ToolResultContent::Text(text.clone()),
        ToolContent::Json(value) => ToolResultContent::Text(
            serde_json::to_string(value).context("serialize JSON tool result content")?,
        ),
    };

    Ok(ContentBlock::ToolResult {
        tool_use_id: result.tool_use_id().to_owned(),
        content,
    })
}
