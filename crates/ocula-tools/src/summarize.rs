use ocula_protocol::ToolResultSummary;

const SUMMARY_CHAR_LIMIT: usize = 500;

pub fn summarize_tool_result_content(content: &str) -> ToolResultSummary {
    let (summary, truncated) = truncate_chars(content, SUMMARY_CHAR_LIMIT);
    let line_count = if content.is_empty() {
        0
    } else {
        content.lines().count() as u32
    };
    ToolResultSummary {
        summary,
        byte_count: content.len() as u32,
        line_count: Some(line_count),
        truncated: if truncated { Some(true) } else { None },
    }
}

fn truncate_chars(text: &str, limit: usize) -> (String, bool) {
    if text.chars().count() <= limit {
        return (text.to_string(), false);
    }
    let truncated: String = text.chars().take(limit).collect();
    (truncated, true)
}
