use std::path::PathBuf;

use serde_json::json;
use tempfile::TempDir;

use crate::llm::protocol::{ContentBlock, ToolResultContent};
use crate::session::{CompactionKind, SessionItemDraft, SessionStore};

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

#[test]
fn fork_rejects_non_turn_boundary() {
    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let mut store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");

    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 0,
            text: "hello".into(),
        })
        .expect("commit user");
    store
        .commit_item(SessionItemDraft::AssistantMessage {
            turn: 0,
            blocks: vec![ContentBlock::Text { text: "hi".into() }],
        })
        .expect("commit assistant");
    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 1,
            text: "next".into(),
        })
        .expect("commit next turn");

    let boundary_id = store.items()[0].base().id.clone();
    let result = store.fork(&dir, &boundary_id);
    match result {
        Err(err) => assert!(err
            .to_string()
            .contains("boundary item must be the last item of its turn")),
        Ok(_) => panic!("expected fork boundary error"),
    }
}

#[test]
fn fork_round_trip_load() {
    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let cwd = PathBuf::from("/workspace/moontide");
    let mut store = SessionStore::create(&dir, cwd.clone()).expect("create");
    let parent_session_id = store.header().session_id.clone();

    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 0,
            text: "one".into(),
        })
        .expect("commit user");
    store
        .commit_item(SessionItemDraft::AssistantMessage {
            turn: 0,
            blocks: vec![ContentBlock::Text { text: "two".into() }],
        })
        .expect("commit assistant");
    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 1,
            text: "three".into(),
        })
        .expect("commit turn 1");

    let boundary_id = store.items()[1].base().id.clone();
    let original_ids: Vec<String> = store.items()[..=1]
        .iter()
        .map(|item| item.base().id.clone())
        .collect();
    let original_ats: Vec<String> = store.items()[..=1]
        .iter()
        .map(|item| item.base().at.clone())
        .collect();

    let child = store.fork(&dir, &boundary_id).expect("fork");
    let child_session_id = child.header().session_id.clone();

    assert_ne!(child_session_id, parent_session_id);
    assert_eq!(child.header().cwd, cwd);
    assert_eq!(
        child.header().parent_session.as_deref(),
        Some(parent_session_id.as_str())
    );
    assert_eq!(child.header().seed_len, 2);
    assert_eq!(child.items().len(), 2);

    for (seq, item) in child.items().iter().enumerate() {
        assert_eq!(item.base().seq, seq as u64);
        assert_eq!(item.base().session_id, child_session_id);
        assert_eq!(item.base().id, original_ids[seq]);
        assert_eq!(item.base().at, original_ats[seq]);
    }

    let loaded = SessionStore::load(&dir, &child_session_id).expect("load child");
    assert_eq!(loaded.header(), child.header());
    assert_eq!(loaded.items(), child.items());
}

#[test]
fn compaction_and_checkpoint_commit_load() {
    use crate::session::{SessionItem, SessionItemBase};

    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let mut store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();

    store
        .commit_item(SessionItemDraft::UserMessage {
            turn: 0,
            text: "seed".into(),
        })
        .expect("commit user");

    let excluded = vec![store.items()[0].base().id.clone()];
    store
        .commit_item(SessionItemDraft::Compaction {
            turn: 1,
            compaction_kind: CompactionKind::Summary,
            compaction_save_id: Some("save-1".into()),
            excluded_item_ids: excluded.clone(),
            before_tokens: Some(10_000),
            after_tokens: Some(2_000),
        })
        .expect("commit compaction");
    store
        .commit_item(SessionItemDraft::CheckpointCreated {
            turn: 1,
            checkpoint_id: "ckpt-1".into(),
        })
        .expect("commit checkpoint");

    let compaction_item = SessionItem::Compaction {
        base: SessionItemBase {
            id: "item-compaction".into(),
            seq: 0,
            session_id: session_id.clone(),
            turn: 1,
            at: "2026-08-15T12:00:00Z".into(),
        },
        compaction_kind: CompactionKind::Prune,
        compaction_save_id: None,
        excluded_item_ids: vec!["a".into(), "b".into()],
        before_tokens: None,
        after_tokens: None,
    };
    let compaction_json = serde_json::to_string(&compaction_item).expect("serialize compaction");
    let compaction_back: SessionItem =
        serde_json::from_str(&compaction_json).expect("deserialize compaction");
    assert_eq!(compaction_item, compaction_back);

    let checkpoint_item = SessionItem::CheckpointCreated {
        base: SessionItemBase {
            id: "item-checkpoint".into(),
            seq: 0,
            session_id,
            turn: 2,
            at: "2026-08-15T12:01:00Z".into(),
        },
        checkpoint_id: "ckpt-2".into(),
    };
    let checkpoint_json = serde_json::to_string(&checkpoint_item).expect("serialize checkpoint");
    let checkpoint_back: SessionItem =
        serde_json::from_str(&checkpoint_json).expect("deserialize checkpoint");
    assert_eq!(checkpoint_item, checkpoint_back);

    let loaded = SessionStore::load(&dir, &store.header().session_id).expect("load");
    assert_eq!(loaded.items().len(), 3);

    match &loaded.items()[1] {
        SessionItem::Compaction {
            compaction_kind,
            compaction_save_id,
            excluded_item_ids,
            before_tokens,
            after_tokens,
            ..
        } => {
            assert_eq!(*compaction_kind, CompactionKind::Summary);
            assert_eq!(compaction_save_id.as_deref(), Some("save-1"));
            assert_eq!(excluded_item_ids, &excluded);
            assert_eq!(*before_tokens, Some(10_000));
            assert_eq!(*after_tokens, Some(2_000));
        }
        other => panic!("expected compaction item, got {other:?}"),
    }

    match &loaded.items()[2] {
        SessionItem::CheckpointCreated { checkpoint_id, .. } => {
            assert_eq!(checkpoint_id, "ckpt-1");
        }
        other => panic!("expected checkpoint item, got {other:?}"),
    }
}
