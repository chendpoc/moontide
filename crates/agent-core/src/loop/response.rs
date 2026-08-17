use std::collections::BTreeSet;

use anyhow::{bail, Result};

use crate::{
    llm::protocol::{ContentBlock, ModelResponse, StopReason},
    tools::ToolCall,
};

pub(crate) enum ResponseAction {
    Terminal {
        assistant_blocks: Vec<ContentBlock>,
    },
    ToolRound {
        assistant_blocks: Vec<ContentBlock>,
        calls: Vec<ToolCall>,
    },
}

pub(crate) fn classify_response(response: &ModelResponse) -> Result<ResponseAction> {
    let mut assistant_blocks = Vec::new();
    let mut calls = Vec::new();
    let mut call_ids = BTreeSet::new();

    for block in &response.content {
        match block {
            ContentBlock::Text { .. } | ContentBlock::Thinking { .. } => {
                assistant_blocks.push(block.clone());
            }
            ContentBlock::ToolUse { id, name, input } => {
                let call = ToolCall::new(id.clone(), name.clone(), input.clone())?;
                if !call_ids.insert(call.tool_use_id().to_owned()) {
                    bail!(
                        "model response contains duplicate ToolUse id: {}",
                        call.tool_use_id()
                    );
                }
                calls.push(call);
            }
            ContentBlock::ToolResult { .. } => {
                bail!("model response must not contain ToolResult blocks");
            }
        }
    }

    match response.stop_reason {
        StopReason::ToolUse if calls.is_empty() => {
            bail!("ToolUse response must contain at least one ToolUse block");
        }
        StopReason::ToolUse => Ok(ResponseAction::ToolRound {
            assistant_blocks,
            calls,
        }),
        StopReason::EndTurn | StopReason::MaxTokens | StopReason::Other(_) if !calls.is_empty() => {
            bail!("terminal model response must not contain ToolUse blocks");
        }
        StopReason::EndTurn | StopReason::MaxTokens | StopReason::Other(_) => {
            Ok(ResponseAction::Terminal { assistant_blocks })
        }
    }
}

/// Extracts assistant-persistable blocks for the R1 terminal path.
#[cfg(test)]
pub(crate) fn terminal_assistant_blocks(response: &ModelResponse) -> Result<Vec<ContentBlock>> {
    match classify_response(response)? {
        ResponseAction::Terminal { assistant_blocks } => Ok(assistant_blocks),
        ResponseAction::ToolRound { .. } => {
            bail!("tool use requires the Tool round implementation")
        }
    }
}
