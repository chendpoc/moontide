use std::path::PathBuf;

use serde_json::json;
use tempfile::TempDir;

use crate::llm::protocol::ContentBlock;
use crate::session::{CompactionKind, SessionItemDraft, SessionStore};
use crate::tools::{ToolCall, ToolContent, ToolResult, ToolResultStatus};

fn sessions_dir(root: &TempDir) -> PathBuf {
    root.path().join("sessions")
}

// 场景：创建 v2 session 后写入消息、ToolCall 与 ToolResult，再重新加载；预期：header、顺序、身份、状态和 payload 往返一致；不变量/副作用：seq 连续，Session Item Log 不产生额外的调用模型。
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
    let call =
        ToolCall::new("tool-1", "read_file", json!({"path": "a.rs"})).expect("create tool call");
    store
        .commit_item(SessionItemDraft::ToolCall {
            turn: 1,
            call: call.clone(),
        })
        .expect("commit call");
    store
        .commit_item(SessionItemDraft::ToolResult {
            turn: 1,
            result: ToolResult::succeeded(&call, ToolContent::Text("file contents".into())),
        })
        .expect("commit result");

    let loaded = SessionStore::load(&dir, &session_id).expect("load");
    assert_eq!(loaded.header().cwd, cwd);
    assert_eq!(loaded.header().parent_session, None);
    assert_eq!(loaded.header().seed_len, 0);
    assert_eq!(loaded.header().version, 2);
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
// 预期：提交被拒绝；不变量：ToolCall 独立存为 SessionItem。
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

// 场景：磁盘上的 item session_id 被篡改为另一场 session 的身份。
// 预期：load 拒绝跨 session item；不变量：Session Item Log 的每行身份必须匹配 header。
#[test]
fn load_rejects_item_from_another_session() {
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

    let log_path = dir.join(format!("{session_id}.log.jsonl"));
    let raw = std::fs::read_to_string(&log_path).expect("read log");
    let mut item: serde_json::Value = serde_json::from_str(raw.trim()).expect("parse item");
    item["session_id"] = json!("other-session");
    std::fs::write(
        &log_path,
        serde_json::to_string(&item).expect("serialize item") + "\n",
    )
    .expect("write log");

    let result = SessionStore::load(&dir, &session_id);
    match result {
        Err(err) => {
            let message = err.to_string();
            assert!(message.contains("session_id mismatch"));
            assert!(message.contains("other-session"));
        }
        Ok(_) => panic!("expected session_id mismatch error"),
    }
}

// 场景：加载并 fork v1 中旧名 tool_invocation/tool_outcome 且结果缺少 status 的 Session Item Log；预期：读取为 ToolCall/ToolResult，把历史状态保守映射为 OutcomeUnknown，并用 v2 写出子 session；不变量/副作用：兼容逻辑只读旧数据，后续持久化统一使用当前 schema。
#[test]
fn load_v1_tool_items_into_canonical_call_and_result_models() {
    use crate::session::SessionItem;

    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();
    let meta_path = dir.join(format!("{session_id}.meta.json"));
    let log_path = dir.join(format!("{session_id}.log.jsonl"));

    let mut meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).expect("read session meta"))
            .expect("parse session meta");
    meta["version"] = json!(1);
    std::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).expect("serialize v1 meta"),
    )
    .expect("write v1 meta");

    let call_line = json!({
        "kind": "tool_invocation",
        "id": "item-call",
        "seq": 0,
        "session_id": session_id,
        "turn": 1,
        "at": "2026-08-15T12:00:00Z",
        "tool_use_id": "tool-1",
        "name": "read_file",
        "input": {"path": "a.rs"}
    });
    let result_line = json!({
        "kind": "tool_outcome",
        "id": "item-result",
        "seq": 1,
        "session_id": session_id,
        "turn": 1,
        "at": "2026-08-15T12:00:01Z",
        "tool_use_id": "tool-1",
        "name": "read_file",
        "content": "ok"
    });
    std::fs::write(
        &log_path,
        format!(
            "{}\n{}\n",
            serde_json::to_string(&call_line).expect("serialize call"),
            serde_json::to_string(&result_line).expect("serialize result")
        ),
    )
    .expect("write v1 log");

    let loaded = SessionStore::load(&dir, &session_id).expect("load v1 session");

    match &loaded.items()[0] {
        SessionItem::ToolCall { call, .. } => {
            assert_eq!(call.tool_use_id(), "tool-1");
            assert_eq!(call.name(), "read_file");
        }
        other => panic!("expected canonical tool call, got {other:?}"),
    }
    match &loaded.items()[1] {
        SessionItem::ToolResult { result, .. } => {
            assert_eq!(result.status(), &ToolResultStatus::OutcomeUnknown);
            assert_eq!(result.content(), &ToolContent::Text("ok".into()));
        }
        other => panic!("expected canonical tool result, got {other:?}"),
    }

    let boundary_id = loaded.items()[1].base().id.clone();
    let forked = loaded
        .fork(&dir, &boundary_id)
        .expect("fork migrated v1 session");
    assert_eq!(forked.header().version, 2);
    let forked_id = forked.header().session_id.clone();
    let forked_log = std::fs::read_to_string(dir.join(format!("{forked_id}.log.jsonl")))
        .expect("read v2 fork log");
    assert!(forked_log.contains("\"kind\":\"tool_result\""));
    assert!(!forked_log.contains("\"kind\":\"tool_outcome\""));
    let reloaded_fork = SessionStore::load(&dir, &forked_id).expect("load v2 fork");
    match &reloaded_fork.items()[1] {
        SessionItem::ToolResult { result, .. } => {
            assert_eq!(result.status(), &ToolResultStatus::OutcomeUnknown);
        }
        other => panic!("expected migrated tool result, got {other:?}"),
    }
}

// 场景：加载含历史 ToolResultContent::Blocks 数组的 v1 session 后继续追加当前 ToolResult，再次重新加载；预期：旧数组无损迁移为 Json、新行按 tagged content 解码且两者顺序稳定；不变量/副作用：append-only 日志不重写历史行，v1 header 下只按 legacy kind 触发迁移。
#[test]
fn load_v1_append_current_tool_result_and_reload_without_content_drift() {
    use crate::session::SessionItem;

    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();
    let meta_path = dir.join(format!("{session_id}.meta.json"));
    let log_path = dir.join(format!("{session_id}.log.jsonl"));

    let mut meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).expect("read session meta"))
            .expect("parse session meta");
    meta["version"] = json!(1);
    std::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).expect("serialize v1 meta"),
    )
    .expect("write v1 meta");

    let legacy_result = json!({
        "kind": "tool_outcome",
        "id": "item-legacy-result",
        "seq": 0,
        "session_id": session_id,
        "turn": 1,
        "at": "2026-08-15T12:00:00Z",
        "tool_use_id": "tool-legacy",
        "name": "grep",
        "content": [
            { "type": "text", "text": "legacy result" }
        ]
    });
    std::fs::write(
        &log_path,
        serde_json::to_string(&legacy_result).expect("serialize legacy result") + "\n",
    )
    .expect("write v1 log");

    let mut loaded = SessionStore::load(&dir, &session_id).expect("load v1 session");
    let call = ToolCall::new("tool-current", "grep", json!({ "pattern": "工具" }))
        .expect("create current call");
    loaded
        .commit_item(SessionItemDraft::ToolResult {
            turn: 2,
            result: ToolResult::succeeded(&call, ToolContent::Json(json!("工具结果"))),
        })
        .expect("append current result");

    let reloaded = SessionStore::load(&dir, &session_id).expect("reload mixed v1 session");
    assert_eq!(reloaded.header().version, 1);
    assert_eq!(reloaded.items().len(), 2);
    match &reloaded.items()[0] {
        SessionItem::ToolResult { result, .. } => {
            assert_eq!(result.status(), &ToolResultStatus::OutcomeUnknown);
            assert_eq!(
                result.content(),
                &ToolContent::Json(json!([
                    { "type": "text", "text": "legacy result" }
                ]))
            );
        }
        other => panic!("expected legacy tool result, got {other:?}"),
    }
    match &reloaded.items()[1] {
        SessionItem::ToolResult { result, .. } => {
            assert_eq!(result.status(), &ToolResultStatus::Succeeded);
            assert_eq!(result.content(), &ToolContent::Json(json!("工具结果")));
        }
        other => panic!("expected current tool result, got {other:?}"),
    }

    let raw_log = std::fs::read_to_string(&log_path).expect("read mixed log");
    assert!(raw_log.contains("\"kind\":\"tool_outcome\""));
    assert!(raw_log.contains("\"kind\":\"tool_result\""));
}

// 场景：磁盘 header 使用既非 v1 也非当前版本的 schema；预期：load 明确拒绝未知版本；不变量/副作用：不猜测未来 schema，也不修改磁盘内容。
#[test]
fn load_rejects_unsupported_header_version() {
    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();
    let meta_path = dir.join(format!("{session_id}.meta.json"));
    let mut meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).expect("read session meta"))
            .expect("parse session meta");
    meta["version"] = json!(99);
    std::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).expect("serialize unsupported meta"),
    )
    .expect("write unsupported meta");

    let error = match SessionStore::load(&dir, &session_id) {
        Ok(_) => panic!("unsupported session version unexpectedly loaded"),
        Err(error) => error,
    };

    assert!(error
        .to_string()
        .contains("unsupported session header version: 99"));
}

// 场景：v2 ToolResult 行被破坏并删除必需的 status；预期：load 拒绝该行，而不是套用 v1 迁移默认值；不变量/副作用：兼容逻辑只作用于 v1 历史数据，不掩盖当前 schema 损坏。
#[test]
fn load_v2_rejects_tool_result_without_status() {
    let root = TempDir::new().expect("tempdir");
    let dir = sessions_dir(&root);
    let mut store = SessionStore::create(&dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();
    let call =
        ToolCall::new("tool-1", "read_file", json!({"path": "a.rs"})).expect("create tool call");
    store
        .commit_item(SessionItemDraft::ToolResult {
            turn: 1,
            result: ToolResult::succeeded(&call, ToolContent::Text("ok".into())),
        })
        .expect("commit tool result");

    let log_path = dir.join(format!("{session_id}.log.jsonl"));
    let mut item: serde_json::Value = serde_json::from_str(
        std::fs::read_to_string(&log_path)
            .expect("read session log")
            .trim(),
    )
    .expect("parse tool result");
    item.as_object_mut()
        .expect("tool result object")
        .remove("status");
    std::fs::write(
        &log_path,
        serde_json::to_string(&item).expect("serialize damaged result") + "\n",
    )
    .expect("write damaged result");

    let error = match SessionStore::load(&dir, &session_id) {
        Ok(_) => panic!("v2 result without status unexpectedly loaded"),
        Err(error) => error,
    };

    assert!(error.to_string().contains("parse session log line 1"));
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

// 场景：把全部 committable TurnEvent 映射到 SessionItem。
// 预期：每类事件写入对应 item；不变量：非 committable 事件不进入 commit。
#[test]
fn commit_from_event_maps_committable_turn_events() {
    use crate::event::{TurnCompactionKind, TurnEvent};
    use crate::session::{commit_from_event, SessionItem};

    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    let user = commit_from_event(
        &mut store,
        &TurnEvent::UserPromptCommitted {
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
        &TurnEvent::AssistantFinalized {
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

    let call =
        ToolCall::new("tool-1", "read_file", json!({"path": "a.rs"})).expect("create tool call");
    let recorded_call = commit_from_event(
        &mut store,
        &TurnEvent::ToolCallRecorded {
            turn: 1,
            call: call.clone(),
        },
    )
    .expect("tool call");
    match recorded_call {
        SessionItem::ToolCall {
            call: stored_call, ..
        } => {
            assert_eq!(stored_call, &call);
        }
        other => panic!("expected tool call, got {other:?}"),
    }

    let result = ToolResult::succeeded(&call, ToolContent::Text("ok".into()));
    let recorded_result = commit_from_event(
        &mut store,
        &TurnEvent::ToolResultRecorded {
            turn: 1,
            result: result.clone(),
        },
    )
    .expect("tool result");
    match recorded_result {
        SessionItem::ToolResult {
            result: stored_result,
            ..
        } => {
            assert_eq!(stored_result, &result);
        }
        other => panic!("expected tool result, got {other:?}"),
    }

    let compaction = commit_from_event(
        &mut store,
        &TurnEvent::CompactionApplied {
            turn: 2,
            compaction_kind: TurnCompactionKind::Summary,
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

// 场景：向 commit_from_event 传入 observational TurnEvent。
// 预期：返回错误且不写 Session Item Log。
#[test]
fn commit_from_event_rejects_non_committable() {
    use crate::event::TurnEvent;
    use crate::session::commit_from_event;

    let root = TempDir::new().expect("tempdir");
    let mut store =
        SessionStore::create(sessions_dir(&root), PathBuf::from("/tmp")).expect("create");

    let err = commit_from_event(&mut store, &TurnEvent::TurnStarted { turn: 0 })
        .expect_err("non-committable");
    assert!(err.to_string().contains("not committable"));
    assert!(err.to_string().contains("TurnStarted"));
}
