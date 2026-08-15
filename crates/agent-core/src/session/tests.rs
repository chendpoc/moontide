use std::path::PathBuf;

use serde_json::json;
use tempfile::TempDir;

use crate::llm::protocol::{ContentBlock, ToolResultContent};
use crate::session::{SessionItemDraft, SessionStore};

fn sessions_dir(root: &TempDir) -> PathBuf {
    root.path().join("sessions")
}

#[test]
fn create_commit_load_round_trip() {
    let root = TempDir::new().expect("tempdir");
    let cwd = PathBuf::from("/workspace/moontide");
    let dir = sessions_dir(&root);

    let mut store = SessionStore::create(&dir, cwd.clone()).expect("create");
    let session_id = store.header().session_id.clone();

    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 0,
            text: "hello".into(),
        })
        .expect("commit user");
    store
        .commit_item(SessionItemDraft::AssistantMessage {
            turn: 0,
            blocks: vec![ContentBlock::Text {
                text: "hi there".into(),
            }],
        })
        .expect("commit assistant");
    store
        .commit_item(SessionItemDraft::ToolInvocation {
            turn: 1,
            tool_use_id: "tool-1".into(),
            name: "read_file".into(),
            input: json!({"path": "a.rs"}),
        })
        .expect("commit invocation");
    store
        .commit_item(SessionItemDraft::ToolOutcome {
            turn: 1,
            tool_use_id: "tool-1".into(),
            content: ToolResultContent::Text("file contents".into()),
        })
        .expect("commit outcome");

    let loaded = SessionStore::load(&dir, &session_id).expect("load");
    assert_eq!(loaded.header().cwd, cwd);
    assert_eq!(loaded.header().parent_session, None);
    assert_eq!(loaded.header().seed_len, 0);
    assert_eq!(loaded.items().len(), 4);

    for (seq, item) in loaded.items().iter().enumerate() {
        assert_eq!(item.base().seq, seq as u64);
        assert_eq!(item.base().session_id, session_id);
        assert!(!item.base().id.is_empty());
        assert!(!item.base().at.is_empty());
    }

    match loaded.items().first() {
        Some(item) => assert_eq!(item.text(), Some("hello")),
        None => panic!("expected at least one item"),
    }
}

#[test]
fn commit_assigns_id_seq_at() {
    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    let session_id = store.header().session_id.clone();
    let item = store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 0,
            text: "ping".into(),
        })
        .expect("commit");

    assert_eq!(item.base().seq, 0);
    assert!(!item.base().id.is_empty());
    assert!(!item.base().at.is_empty());
    assert_eq!(item.base().session_id, session_id);
}

#[test]
fn assistant_with_tool_block_rejected() {
    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    let err = store
        .commit_item(SessionItemDraft::AssistantMessage {
            turn: 0,
            blocks: vec![ContentBlock::ToolUse {
                id: "t1".into(),
                name: "grep".into(),
                input: json!({}),
            }],
        })
        .expect_err("tool block in assistant");

    assert!(err
        .to_string()
        .contains("assistant message blocks must not contain tool blocks"));
}

#[test]
fn load_rejects_seq_gap() {
    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let mut store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();

    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 0,
            text: "one".into(),
        })
        .expect("commit");
    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 1,
            text: "two".into(),
        })
        .expect("commit");

    let log_path = dir.join(format!("{session_id}.log.jsonl"));
    let raw = std::fs::read_to_string(&log_path).expect("read log");
    let mut lines: Vec<String> = raw.lines().map(str::to_string).collect();
    let mut second: serde_json::Value = serde_json::from_str(&lines[1]).expect("parse line");
    second["seq"] = json!(5);
    lines[1] = serde_json::to_string(&second).expect("serialize line");
    std::fs::write(&log_path, lines.join("\n") + "\n").expect("write log");

    let result = SessionStore::load(&dir, &session_id);
    match result {
        Err(err) => assert!(err.to_string().contains("seq gap")),
        Ok(_) => panic!("expected seq gap error"),
    }
}

#[test]
fn turn_cannot_decrease() {
    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 2,
            text: "later".into(),
        })
        .expect("commit");

    let err = store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 1,
            text: "earlier".into(),
        })
        .expect_err("turn decrease");

    assert!(err.to_string().contains("turn cannot decrease"));
}

#[test]
fn session_item_serde_round_trip() {
    use crate::session::{SessionHeader, SessionItem};
    use crate::session::{SessionItemBase, SESSION_HEADER_VERSION};

    let item = SessionItem::AssistantMessage {
        base: SessionItemBase {
            id: "item-1".into(),
            seq: 0,
            session_id: "sess-1".into(),
            turn: 0,
            at: "2026-08-15T12:00:00Z".into(),
        },
        blocks: vec![
            ContentBlock::Thinking {
                thinking: "hmm".into(),
            },
            ContentBlock::Text {
                text: "answer".into(),
            },
        ],
    };

    let json = serde_json::to_string(&item).expect("serialize");
    let back: SessionItem = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(item, back);

    let header = SessionHeader {
        version: SESSION_HEADER_VERSION,
        session_id: "sess-1".into(),
        cwd: PathBuf::from("/tmp"),
        parent_session: None,
        seed_len: 0,
    };
    let header_json = serde_json::to_string(&header).expect("serialize header");
    let header_back: SessionHeader =
        serde_json::from_str(&header_json).expect("deserialize header");
    assert_eq!(header, header_back);
}
