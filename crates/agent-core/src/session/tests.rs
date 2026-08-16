use std::path::PathBuf;

use serde_json::json;
use tempfile::TempDir;

use crate::llm::protocol::{ContentBlock, ToolResultContent};
use crate::session::{CompactionKind, SessionItemDraft, SessionStore};

fn sessions_dir(root: &TempDir) -> PathBuf {
    root.path().join("sessions")
}

// 场景：创建 session 后写入多类 SessionItem，再重新加载。
// 预期：header、顺序、身份和 payload 往返一致；不变量：seq 连续。
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

// 场景：首次提交一条 SessionItem。
// 预期：store 分配 id、seq、at 和 session_id，不接受调用方自填。
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

// 场景：AssistantMessage 包含 ToolUse block。
// 预期：提交被拒绝；不变量：tool invocation 独立存为 SessionItem。
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

// 场景：从磁盘加载 seq 不连续的 Session Item Log。
// 预期：load 返回错误，不静默修复事实源。
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

// 场景：提交 turn 小于当前最后一条 item 的 draft。
// 预期：校验失败；不变量：Session Item Log 的 turn 单调不下降。
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

// 场景：SessionItem 经过 serde 序列化后再反序列化。
// 预期：kind、base 和 payload 保持一致；不变量：协议可往返。
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

// 场景：fork 边界不是所在 turn 的最后一条 item。
// 预期：fork 被拒绝，不创建错误的子 session。
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

// 场景：在合法 turn 边界 fork，并重新加载子 session。
// 预期：父子关系、seed_len 和 item 顺序可恢复；不变量：子 log seq 连续。
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

// 场景：提交 compaction 与 checkpoint 后重新加载 session。
// 预期：两类控制 item 保持字段和顺序；不变量：事实源只 append、不改历史。
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

// 场景：把全部 committable RunEvent 映射到 SessionItem。
// 预期：每类事件写入对应 item；不变量：非 committable 事件不进入 commit。
#[test]
fn commit_from_event_maps_committable_run_events() {
    use crate::event::{RunCompactionKind, RunEvent};
    use crate::session::{commit_from_event, SessionItem};

    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    let user = commit_from_event(
        &mut store,
        &RunEvent::UserPromptCommitted {
            turn: 0,
            text: "hello".into(),
        },
    )
    .expect("user prompt");
    match user {
        SessionItem::UserMessage { text, .. } => assert_eq!(text, "hello"),
        other => panic!("expected user message, got {other:?}"),
    }

    let assistant = commit_from_event(
        &mut store,
        &RunEvent::AssistantFinalized {
            turn: 0,
            blocks: vec![ContentBlock::Text {
                text: "reply".into(),
            }],
        },
    )
    .expect("assistant");
    match assistant {
        SessionItem::AssistantMessage { blocks, .. } => {
            assert_eq!(blocks.len(), 1);
        }
        other => panic!("expected assistant message, got {other:?}"),
    }

    let invocation = commit_from_event(
        &mut store,
        &RunEvent::ToolInvocationRecorded {
            turn: 1,
            tool_use_id: "tool-1".into(),
            name: "read_file".into(),
            input: json!({"path": "a.rs"}),
        },
    )
    .expect("invocation");
    match invocation {
        SessionItem::ToolInvocation {
            tool_use_id,
            name,
            input,
            ..
        } => {
            assert_eq!(tool_use_id, "tool-1");
            assert_eq!(name, "read_file");
            assert_eq!(input, &json!({"path": "a.rs"}));
        }
        other => panic!("expected tool invocation, got {other:?}"),
    }

    let outcome = commit_from_event(
        &mut store,
        &RunEvent::ToolOutcomeRecorded {
            turn: 1,
            tool_use_id: "tool-1".into(),
            content: ToolResultContent::Text("ok".into()),
        },
    )
    .expect("outcome");
    match outcome {
        SessionItem::ToolOutcome {
            tool_use_id,
            content,
            ..
        } => {
            assert_eq!(tool_use_id, "tool-1");
            assert_eq!(content, &ToolResultContent::Text("ok".into()));
        }
        other => panic!("expected tool outcome, got {other:?}"),
    }

    let compaction = commit_from_event(
        &mut store,
        &RunEvent::CompactionApplied {
            turn: 2,
            compaction_kind: RunCompactionKind::Summary,
            compaction_save_id: Some("save-1".into()),
            excluded_item_ids: vec!["item-0".into()],
            before_tokens: Some(9_000),
            after_tokens: Some(1_500),
        },
    )
    .expect("compaction");
    match compaction {
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
            assert_eq!(excluded_item_ids, &["item-0"]);
            assert_eq!(*before_tokens, Some(9_000));
            assert_eq!(*after_tokens, Some(1_500));
        }
        other => panic!("expected compaction, got {other:?}"),
    }

    assert_eq!(store.items().len(), 5);
}

// 场景：向 commit_from_event 传入 observational RunEvent。
// 预期：返回错误且不写 Session Item Log。
#[test]
fn commit_from_event_rejects_non_committable() {
    use crate::event::RunEvent;
    use crate::session::commit_from_event;

    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    let err = commit_from_event(&mut store, &RunEvent::TurnStarted { turn: 0 })
        .expect_err("non-committable");
    assert!(err.to_string().contains("not committable"));
    assert!(err.to_string().contains("TurnStarted"));
}
