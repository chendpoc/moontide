use anyhow::{bail, Result};

use crate::llm::protocol::{ContentBlock, ModelResponse, StopReason};

/// Extracts assistant-persistable blocks for the R1 terminal path.
pub(crate) fn terminal_assistant_blocks(response: &ModelResponse) -> Result<Vec<ContentBlock>> {
    if matches!(response.stop_reason, StopReason::ToolUse) {
        bail!("tool use requires the Tool round implementation");
    }

    let mut assistant_blocks = Vec::new();
    for block in &response.content {
        match block {
            ContentBlock::Text { .. } | ContentBlock::Thinking { .. } => {
                assistant_blocks.push(block.clone());
            }
            ContentBlock::ToolUse { .. } => {
                bail!("terminal model response must not contain ToolUse blocks");
            }
            ContentBlock::ToolResult { .. } => {
                bail!("model response must not contain ToolResult blocks");
            }
        }
    }
    Ok(assistant_blocks)
}
