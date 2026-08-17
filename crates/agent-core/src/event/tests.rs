use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use tempfile::TempDir;

use crate::event::{CommitHandler, EventDispatcher, TurnCompactionKind, TurnEvent};
use crate::llm::protocol::ContentBlock;
use crate::session::{SessionCommitHandler, SessionItem, SessionStore};
use crate::tools::{ToolCall, ToolContent, ToolResult};

struct RecordingCommitHandler {
    events: Arc<Mutex<Vec<TurnEvent>>>,
}

impl CommitHandler for RecordingCommitHandler {
    fn commit(&self, event: &TurnEvent) -> Result<()> {
        self.events
            .lock()
            .map_err(|_| anyhow!("recording commit lock poisoned"))?
            .push(event.clone());
        Ok(())
    }
}

struct FailingCommitHandler;

impl CommitHandler for FailingCommitHandler {
    fn commit(&self, _event: &TurnEvent) -> Result<()> {
        Err(anyhow!("commit failed"))
    }
}

// 场景：loop 向 dispatcher 提交一个 TurnEvent 事实。
// 预期：注入的 commit handler 精确收到一次原事件；不变量：event 不增加 hook、observe 或文件副作用。
#[test]
fn dispatcher_commits_event_exactly_once() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let dispatcher = EventDispatcher::new(Arc::new(RecordingCommitHandler {
        events: Arc::clone(&events),
    }));
    let event = TurnEvent::UserPromptCommitted {
        turn: 3,
        text: "hello".to_string(),
    };

    dispatcher.emit(event.clone()).expect("commit event");

    assert_eq!(*events.lock().expect("read committed events"), vec![event]);
}

// 场景：Session commit adapter 返回基础设施错误。
// 预期：dispatcher 将原错误传播给 turn 边界；不变量：event 层不吞错或伪造成功。
#[test]
fn dispatcher_propagates_commit_error() {
    let dispatcher = EventDispatcher::new(Arc::new(FailingCommitHandler));

    let result = dispatcher.emit(TurnEvent::UserPromptCommitted {
        turn: 0,
        text: "hello".to_string(),
    });

    assert!(result.is_err());
}

// 场景：全部当前 TurnEvent 变体携带所属 turn。
// 预期：turn() 对每个事实返回相同坐标；不变量：event 协议只保留可提交的 Session 事实。
#[test]
fn turn_event_variants_expose_their_turn() {
    let call = ToolCall::new("tool-1", "grep", serde_json::json!({})).expect("create call");
    let events = [
        TurnEvent::UserPromptCommitted {
            turn: 7,
            text: "hello".to_string(),
        },
        TurnEvent::AssistantFinalized {
            turn: 7,
            blocks: vec![ContentBlock::Text {
                text: "done".to_string(),
            }],
        },
        TurnEvent::ToolCallRecorded {
            turn: 7,
            call: call.clone(),
        },
        TurnEvent::ToolResultRecorded {
            turn: 7,
            result: ToolResult::succeeded(&call, ToolContent::Text("ok".to_string())),
        },
        TurnEvent::CompactionApplied {
            turn: 7,
            compaction_kind: TurnCompactionKind::Prune,
            compaction_save_id: None,
            excluded_item_ids: vec![],
            before_tokens: None,
            after_tokens: None,
        },
    ];

    assert!(events.iter().all(|event| event.turn() == 7));
}

// 场景：生产 SessionCommitHandler 接入 dispatcher 后提交用户事实。
// 预期：Session Item Log 落下一条对应 UserMessage；不变量：session 仍是事实源唯一写者。
#[test]
fn dispatcher_commits_through_session_adapter() {
    let root = TempDir::new().expect("tempdir");
    let sessions_dir = root.path().join("sessions");
    let store = SessionStore::create(&sessions_dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();
    let dispatcher = EventDispatcher::new(Arc::new(SessionCommitHandler::new(store)));

    dispatcher
        .emit(TurnEvent::UserPromptCommitted {
            turn: 0,
            text: "hello integration".to_string(),
        })
        .expect("commit user prompt");

    let loaded = SessionStore::load(&sessions_dir, &session_id).expect("load session");
    assert!(matches!(
        loaded.items(),
        [SessionItem::UserMessage { text, .. }] if text == "hello integration"
    ));
}
