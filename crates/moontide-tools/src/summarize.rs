use moontide_protocol::ToolResultSummary;

use crate::projection::{prepare_tool_outcome, ToolProjectionConfig};

/// Legacy 500-char summary — prefer `prepare_tool_outcome` with config.
pub fn summarize_tool_result_content(content: &str) -> ToolResultSummary {
    let config = ToolProjectionConfig {
        artifact_min: usize::MAX,
        preview_chars: 500,
        ..ToolProjectionConfig::from_env()
    };
    prepare_tool_outcome(content, &config).result_summary
}
