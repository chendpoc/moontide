use moontide_tools::{prepare_tool_outcome, ToolProjectionConfig};

#[test]
fn git_diff_truncated_json_shape() {
    let cfg = ToolProjectionConfig {
        artifact_min: 50,
        preview_chars: 20,
        ..ToolProjectionConfig::from_env()
    };
    let large = "line\n".repeat(300);
    let prep = prepare_tool_outcome(&large, &cfg);
    assert!(prep.store_artifact);
    assert_eq!(prep.result_summary.truncated, Some(true));
}

#[test]
fn record_tool_hint_writes_file() {
    let dir = tempfile::tempdir().unwrap();
    let out = moontide_tools::run_record_tool_hint(
        dir.path(),
        "bash",
        "used bash git diff",
        "use git_diff with stat=true",
        Some("git_diff stat=true"),
        Some("git"),
    );
    assert!(out.contains("\"status\":\"ok\""));
    let entries: Vec<_> = std::fs::read_dir(dir.path().join("docs/notes/tool-hints"))
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(entries.len(), 1);
}
