use ocula_protocol::ToolResultSummary;

use crate::names;

/// Actionable recovery steps when a tool result was truncated in projection.
pub fn strategies_for(tool_name: &str, preview: &str) -> Vec<&'static str> {
    if tool_name == names::BASH && looks_like_git_diff(preview) {
        return vec![
            "Do NOT re-run `bash git diff` on the whole repo — output will truncate again",
            "Overview first: git_diff stat=true (or git_status for changed files)",
            "One scope at a time: git_diff path=crates/<crate>/ or path=<single-file>",
            "Need verbatim once: read_artifact <id> — never repeat the same bash command",
            "Many files: split by directory and summarize each stat, not full diffs",
        ];
    }

    match tool_name {
        names::BASH => vec![
            "Narrow the command (single file/dir, head/tail, wc -l first)",
            "Prefer dedicated tools: read_file, grep, git_* instead of bash",
            "If output is in an artifact: read_artifact <id> once, then work from that",
        ],
        names::GIT_DIFF => vec![
            "Default stat=true; avoid full diff unless reviewing one file",
            "Scope down: git_diff path=<file-or-dir>",
            "Large artifact: read_artifact <id> only for the one file you must inspect",
        ],
        names::GIT_STATUS | names::GIT_LOG => vec![
            "Output is usually small; if truncated, read_artifact <id> once",
            "For diffs use git_diff stat=true, not bash git diff",
        ],
        names::READ_FILE => vec![
            "Paginate: read_file path=... offset=<line> limit=200",
            "Search inside file: grep pattern=... path=<file>",
            "Artifact: read_artifact <id> then grep locally if still too large",
        ],
        names::GREP => vec![
            "Narrow: path=<dir-or-file>, glob=*.rs, lower max_results",
            "More specific pattern; avoid repo-wide search when truncated",
        ],
        names::LIST_DIR | names::GLOB => vec![
            "Non-recursive list_dir or tighter glob (e.g. crates/ocula-*/src/**)",
            "One directory level at a time instead of whole tree",
        ],
        names::READ_ARTIFACT => vec![
            "Artifact still large: grep the content or read a slice mentally and act",
            "Re-fetch only if you need a different artifact id",
        ],
        _ => vec![
            "Use narrower tool args instead of repeating the same call",
            "read_artifact <id> once if full text is required",
        ],
    }
}

pub fn format_strategy_lines(tool_name: &str, preview: &str) -> String {
    let steps = strategies_for(tool_name, preview);
    if steps.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n[strategies]\n");
    for (i, step) in steps.iter().enumerate() {
        out.push_str(&format!("{}. {step}\n", i + 1));
    }
    out.trim_end().to_string()
}

pub fn format_truncation_with_strategies(
    tool_name: &str,
    summary: &ToolResultSummary,
    artifact_id: Option<&str>,
) -> String {
    if summary.truncated != Some(true) {
        return summary.summary.clone();
    }

    let artifact_hint = artifact_id
        .map(|id| format!("; artifact: {id}"))
        .unwrap_or_default();

    let header = format!(
        "{}… [truncated: {} bytes total{artifact_hint}]",
        summary.summary.trim_end_matches('…'),
        summary.byte_count
    );

    format!(
        "{}{}",
        header,
        format_strategy_lines(tool_name, &summary.summary)
    )
}

pub fn format_bundle_strategy_section(truncated: &[(String, u32)]) -> String {
    if truncated.is_empty() {
        return String::new();
    }

    let mut lines = vec!["[strategies for truncated tools]".to_string()];
    let mut seen = std::collections::HashSet::new();

    for (tool_name, byte_count) in truncated {
        let key = format!("{tool_name}:{byte_count}");
        if !seen.insert(key) {
            continue;
        }
        lines.push(format!("— {tool_name} ({byte_count}B):"));
        for (i, step) in strategies_for(tool_name, "").iter().enumerate() {
            lines.push(format!("  {}. {step}", i + 1));
        }
    }

    lines.join("\n")
}

fn looks_like_git_diff(preview: &str) -> bool {
    preview.contains("diff --git") || preview.starts_with("diff --git")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bash_git_diff_gets_git_specific_strategies() {
        let steps = strategies_for(names::BASH, "diff --git a/foo b/foo");
        assert!(steps[0].contains("Do NOT re-run"));
        assert!(steps.iter().any(|s| s.contains("git_diff stat")));
    }

    #[test]
    fn footnote_includes_strategy_block() {
        let summary = ToolResultSummary {
            summary: "diff --git a/x".into(),
            byte_count: 14984,
            line_count: None,
            truncated: Some(true),
        };
        let text = format_truncation_with_strategies(names::BASH, &summary, Some("art_1"));
        assert!(text.contains("[truncated:"));
        assert!(text.contains("[strategies]"));
        assert!(text.contains("git_diff stat"));
    }
}
