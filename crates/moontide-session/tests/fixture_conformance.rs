use std::fs;

use moontide_protocol::SessionLog;
use moontide_session::{FileSessionLogReader, session_log_path};
use tempfile::tempdir;

#[test]
fn reads_ts_fixture_jsonl() {
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/session/ts-user-assistant.jsonl");
    let dir = tempdir().expect("tempdir");
    let dest = session_log_path(dir.path(), "sess-fixture");
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).expect("mkdir sessions");
    }
    fs::copy(&fixture, &dest).expect("copy fixture");

    let reader = FileSessionLogReader::new(dir.path());
    let log = reader.read_all("sess-fixture").expect("read fixture");

    assert_eq!(log.len(), 2);
    match &log[0] {
        SessionLog::UserMessage { text, .. } => assert_eq!(text, "hi"),
        _ => panic!("expected user_message"),
    }
    match &log[1] {
        SessionLog::AssistantMessage { blocks, .. } => assert!(!blocks.is_empty()),
        _ => panic!("expected assistant_message"),
    }
}
