use std::sync::Arc;

use anyhow::Result;
use ocula_protocol::ContentBlock;
use ocula_session::Session;
use ocula_tools::{
    check_permission, execute_tool, summarize_tool_result_content, ApproveToolRequest, Decision,
    ToolContext, UserInteraction,
};
use serde_json::Value;

#[derive(Debug, Clone)]
pub enum ToolUseOutcome {
    Succeeded { output: String },
    Denied { reason: String },
    Rejected { reason: String },
    Failed { error: String },
}

pub fn tool_result_content(outcome: &ToolUseOutcome) -> String {
    match outcome {
        ToolUseOutcome::Succeeded { output } => output.clone(),
        ToolUseOutcome::Denied { reason } => reason.clone(),
        ToolUseOutcome::Rejected { reason } => reason.clone(),
        ToolUseOutcome::Failed { error } => error.clone(),
    }
}

pub async fn resolve_tool_use_outcome(
    tool_name: &str,
    input: Value,
    workdir: &std::path::Path,
    interaction: Arc<dyn UserInteraction>,
) -> ToolUseOutcome {
    let decision = check_permission(tool_name, &input, workdir);
    match decision {
        Decision::Deny => {
            return ToolUseOutcome::Denied {
                reason: format!("Permission denied: {tool_name}"),
            };
        }
        Decision::Ask => {
            let approved = interaction
                .approve_tool(ApproveToolRequest {
                    tool_name: tool_name.into(),
                    input: input.clone(),
                })
                .await;
            if !approved {
                return ToolUseOutcome::Rejected {
                    reason: format!("Permission denied by user: {tool_name}"),
                };
            }
        }
        Decision::Allow => {}
    }

    let ctx = ToolContext::new(workdir);
    match execute_tool(tool_name, input, &ctx).await {
        Ok(output) => {
            if let Some(rest) = output.strip_prefix("Error: ") {
                ToolUseOutcome::Failed {
                    error: rest.to_string(),
                }
            } else {
                ToolUseOutcome::Succeeded { output }
            }
        }
        Err(e) => ToolUseOutcome::Failed {
            error: e.to_string(),
        },
    }
}

pub async fn run_tool_use(
    block: &ContentBlock,
    turn: u32,
    session: &Session,
    workdir: &std::path::Path,
    interaction: Arc<dyn UserInteraction>,
) -> Result<String> {
    let ContentBlock::ToolUse { id, name, input } = block else {
        anyhow::bail!("not a tool_use block");
    };

    session
        .append_tool_invocation(turn, id.clone(), name.clone(), input.clone())
        .await?;

    let outcome = resolve_tool_use_outcome(name, input.clone(), workdir, interaction).await;
    let content = tool_result_content(&outcome);

    session
        .append_tool_outcome(turn, id.clone(), summarize_tool_result_content(&content))
        .await?;

    Ok(content)
}

pub async fn run_tool_uses(
    blocks: &[ContentBlock],
    turn: u32,
    session: &Session,
    workdir: &std::path::Path,
    interaction: Arc<dyn UserInteraction>,
) -> Result<Vec<String>> {
    let mut results = Vec::new();
    for block in blocks {
        if matches!(block, ContentBlock::ToolUse { .. }) {
            results.push(
                run_tool_use(block, turn, session, workdir, interaction.clone())
                    .await?,
            );
        }
    }
    Ok(results)
}
