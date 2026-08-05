use moontide_protocol::ToolResultSummary;

use crate::projection::{prepare_tool_outcome, ToolProjectionConfig};

/// Legacy summary helper — prefer `prepare_tool_outcome` with config.
pub fn summarize_tool_result_content(content: &str) -> ToolResultSummary {
    let config = ToolProjectionConfig {
        artifact_min: usize::MAX,
        ..ToolProjectionConfig::from_env()
    };
    prepare_tool_outcome(content, &config).result_summary
}
