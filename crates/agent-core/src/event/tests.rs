use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use tempfile::TempDir;

use crate::event::{
    derive_agent_event, truncate_record, AgentChannel, AgentEventRecord, AgentEventWriter,
    AgentPhase, CommitHandler, DeriveObserveHandler, EventDispatcher, FileAgentEventWriter,
    HookHandler, HookOutcome, ObserveHandler, PipelineRegistry, RunEvent, TraceContext,
    MAX_AGENT_EVENT_BYTES,
};
use crate::llm::protocol::{ContentBlock, ModelResponseSnapshot, PendingBlock, StopReason, Usage};
use crate::session::{SessionCommitHandler, SessionItem, SessionStore};

struct MockCommitHandler {
    calls: Arc<AtomicUsize>,
}

impl MockCommitHandler {
    fn new(calls: Arc<AtomicUsize>) -> Self {
        Self { calls }
    }
}

impl CommitHandler for MockCommitHandler {
    fn commit(&self, _event: &RunEvent) -> Result<Option<String>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Some("item-1".to_string()))
    }
}

struct BlockingHook;

impl HookHandler for BlockingHook {
    fn on_event(&self, _ctx: &TraceContext, _event: &RunEvent) -> Result<HookOutcome> {
        Ok(HookOutcome::Block {
            reason: "denied".to_string(),
        })
    }
}

struct FailingObserveHandler;

impl ObserveHandler for FailingObserveHandler {
    fn observe(&self, _ctx: &TraceContext, _event: &RunEvent) -> Result<()> {
        Err(anyhow!("observe failed"))
    }
}

struct RecordingObserveHandler {
    events: Arc<Mutex<Vec<RunEvent>>>,
}

impl RecordingObserveHandler {
    fn new(events: Arc<Mutex<Vec<RunEvent>>>) -> Self {
        Self { events }
    }
}

impl ObserveHandler for RecordingObserveHandler {
    fn observe(&self, _ctx: &TraceContext, event: &RunEvent) -> Result<()> {
        self.events
            .lock()
            .map_err(|_| anyhow!("observe lock poisoned"))?
            .push(event.clone());
        Ok(())
    }
}

fn test_dispatcher(
    commit_calls: Arc<AtomicUsize>,
    extra_hooks: Vec<Arc<dyn HookHandler>>,
    extra_observers: Vec<Arc<dyn ObserveHandler>>,
) -> EventDispatcher {
    let mut builder = PipelineRegistry::builder()
        .commit(Arc::new(MockCommitHandler::new(Arc::clone(&commit_calls))));
    for hook in extra_hooks {
        builder = builder.hook(hook);
    }
    for observer in extra_observers {
        builder = builder.observe(observer);
    }
    let registry = builder.build_frozen().expect("registry");
    EventDispatcher::new(registry, TraceContext::new("run-1", "session-1"))
}

// 场景：可提交的 RunEvent 进入 dispatcher。
// 预期：commit handler 执行一次并回填 session item id；不变量：先 commit 再 observe。
#[test]
fn committable_event_triggers_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(Arc::clone(&commit_calls), vec![], vec![]);

    dispatcher
        .emit(RunEvent::UserPromptCommitted {
            turn: 1,
            text: "hello".to_string(),
        })
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        dispatcher.trace().session_item_id.as_deref(),
        Some("item-1")
    );
}

// 场景：观测类 RunEvent 进入 dispatcher。
// 预期：不会调用 commit handler，也不会产生 session item id。
#[test]
fn observational_event_skips_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(Arc::clone(&commit_calls), vec![], vec![]);

    dispatcher
        .emit(RunEvent::TurnStarted { turn: 1 })
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 0);
    assert!(dispatcher.trace().session_item_id.is_none());
}

// 场景：hook 阻断可提交事件。
// 预期：emit 成功返回但跳过 commit；不变量：被阻断事件不得写 Session。
#[test]
fn hook_block_skips_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(
        Arc::clone(&commit_calls),
        vec![Arc::new(BlockingHook)],
        vec![],
    );

    dispatcher
        .emit(RunEvent::UserPromptCommitted {
            turn: 1,
            text: "blocked".to_string(),
        })
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 0);
    assert!(dispatcher.trace().session_item_id.is_none());
}

// 场景：第一个 observer 返回错误，后续 observer 仍可运行。
// 预期：observe fail-open；不变量：观测错误不阻断 dispatcher。
#[test]
fn observe_fail_open_continues_dispatch() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let observed = Arc::new(Mutex::new(Vec::new()));
    let mut dispatcher = test_dispatcher(
        Arc::clone(&commit_calls),
        vec![],
        vec![
            Arc::new(FailingObserveHandler),
            Arc::new(RecordingObserveHandler::new(Arc::clone(&observed))),
        ],
    );

    dispatcher
        .emit(RunEvent::TurnStarted { turn: 2 })
        .expect("emit");

    let events = observed.lock().expect("lock");
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], RunEvent::TurnStarted { turn: 2 }));
}

// 场景：可提交事件同时配置 commit 和 observer。
// 预期：observer 在 commit 之后收到事件；不变量：commit 顺序稳定。
#[test]
fn committable_runs_observe_after_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let observed = Arc::new(Mutex::new(Vec::new()));
    let mut dispatcher = test_dispatcher(
        Arc::clone(&commit_calls),
        vec![],
        vec![Arc::new(RecordingObserveHandler::new(Arc::clone(
            &observed,
        )))],
    );

    dispatcher
        .emit(RunEvent::AssistantFinalized {
            turn: 1,
            blocks: vec![ContentBlock::Text {
                text: "done".to_string(),
            }],
        })
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 1);
    let events = observed.lock().expect("lock");
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], RunEvent::AssistantFinalized { .. }));
}

fn test_ctx() -> TraceContext {
    TraceContext::new("run-derive", "session-derive")
}

// 场景：用户消息事件派生为 conversation/user_prompt。
// 预期：channel、kind、phase 和 payload 保持事件语义。
#[test]
fn derive_user_prompt_committed_maps_conversation() {
    let ctx = test_ctx();
    let record = derive_agent_event(
        &ctx,
        &RunEvent::UserPromptCommitted {
            turn: 1,
            text: "hello world".to_string(),
        },
    )
    .expect("record");

    assert_eq!(record.channel, AgentChannel::Conversation);
    assert_eq!(record.kind, "user_prompt");
    assert_eq!(record.phase, AgentPhase::PreLlm);
    assert_eq!(record.turn, 1);
    assert_eq!(record.run_id, "run-derive");
    assert_eq!(record.payload["text"], "hello world");
    assert_eq!(record.preview.as_deref(), Some("hello world"));
}

// 场景：turn 开始与结束事件进行 trace 派生。
// 预期：两者映射到 trace channel，结束事件使用 stop phase。
#[test]
fn derive_turn_lifecycle_maps_trace() {
    let ctx = test_ctx();

    let started = derive_agent_event(&ctx, &RunEvent::TurnStarted { turn: 3 }).expect("started");
    assert_eq!(started.channel, AgentChannel::Trace);
    assert_eq!(started.kind, "turn_started");
    assert_eq!(started.phase, AgentPhase::PreLlm);
    assert_eq!(started.turn, 3);

    let ended = derive_agent_event(&ctx, &RunEvent::TurnEnded { turn: 3 }).expect("ended");
    assert_eq!(ended.channel, AgentChannel::Trace);
    assert_eq!(ended.kind, "turn_ended");
    assert_eq!(ended.phase, AgentPhase::Stop);
}

// 场景：同一个 LLM call 的开始与结束事件进行派生。
// 预期：保留 call id、状态和 usage；不变量：仍属于 trace channel。
#[test]
fn derive_llm_call_started_and_ended_maps_trace() {
    let ctx = test_ctx();

    let started = derive_agent_event(
        &ctx,
        &RunEvent::LlmCallStarted {
            turn: 2,
            step: 1,
            llm_call_id: "call-1".to_string(),
        },
    )
    .expect("started");
    assert_eq!(started.channel, AgentChannel::Trace);
    assert_eq!(started.kind, "llm_call");
    assert_eq!(started.payload["status"], "started");
    assert_eq!(started.payload["llmCallId"], "call-1");

    let ended = derive_agent_event(
        &ctx,
        &RunEvent::LlmCallEnded {
            turn: 2,
            step: 1,
            llm_call_id: "call-1".to_string(),
            stop_reason: StopReason::EndTurn,
            usage: Some(Usage {
                input_tokens: 10,
                output_tokens: 5,
            }),
        },
    )
    .expect("ended");
    assert_eq!(ended.channel, AgentChannel::Trace);
    assert_eq!(ended.kind, "llm_call");
    assert_eq!(ended.payload["status"], "ended");
    assert_eq!(ended.payload["usage"]["input_tokens"], 10);
}

// 场景：流式 snapshot 只有 pending text，没有最终 content。
// 预期：派生为 assistant_text，并保留正文和字符数。
#[test]
fn derive_message_update_pending_text_maps_assistant_text() {
    let ctx = test_ctx();
    let record = derive_agent_event(
        &ctx,
        &RunEvent::MessageUpdate {
            turn: 1,
            step: 0,
            llm_call_id: "call-2".to_string(),
            snapshot: ModelResponseSnapshot {
                content: vec![],
                pending: Some(PendingBlock::Text {
                    text: "partial".to_string(),
                }),
                stop_reason: None,
                usage: None,
                model: None,
            },
        },
    )
    .expect("record");

    assert_eq!(record.channel, AgentChannel::Trace);
    assert_eq!(record.kind, "assistant_text");
    assert_eq!(record.payload["body"], "partial");
    assert_eq!(record.payload["charCount"], 7);
}

// 场景：assistant 最终消息包含 text 与 thinking blocks。
// 预期：派生为 conversation/final，正文来自最终 text block。
#[test]
fn derive_assistant_finalized_maps_conversation_final() {
    let ctx = test_ctx();
    let record = derive_agent_event(
        &ctx,
        &RunEvent::AssistantFinalized {
            turn: 1,
            blocks: vec![
                ContentBlock::Text {
                    text: "hello".to_string(),
                },
                ContentBlock::Thinking {
                    thinking: "hmm".to_string(),
                },
            ],
        },
    )
    .expect("record");

    assert_eq!(record.channel, AgentChannel::Conversation);
    assert_eq!(record.kind, "final");
    assert_eq!(record.payload["text"], "hello");
}

// 场景：tool outcome 携带工具名称、调用 ID 和文本结果。
// 预期：trace/tool_result payload 保留 toolName；不变量：观测日志可独立识别工具。
#[test]
fn derive_tool_outcome_includes_tool_name() {
    let record = derive_agent_event(
        &test_ctx(),
        &RunEvent::ToolOutcomeRecorded {
            turn: 1,
            tool_use_id: "tool-1".into(),
            name: "read_file".into(),
            content: crate::llm::protocol::ToolResultContent::Text("ok".into()),
        },
    )
    .expect("record");

    assert_eq!(record.channel, AgentChannel::Trace);
    assert_eq!(record.kind, "tool_result");
    assert_eq!(record.payload["toolName"], "read_file");
    assert_eq!(record.payload["toolUseId"], "tool-1");
    assert_eq!(record.payload["body"], "ok");
}

// 场景：Agent Event payload 达到 64 KiB 边界。
// 预期：记录被截断且序列化后不超过上限；不变量：保留 original_bytes。
#[test]
fn truncate_record_enforces_64kib_limit() {
    let huge = "x".repeat(MAX_AGENT_EVENT_BYTES);
    let record = AgentEventRecord {
        id: "id-1".to_string(),
        seq: Some(u64::MAX),
        run_id: "run-1".to_string(),
        turn: 1,
        phase: AgentPhase::PreLlm,
        channel: AgentChannel::Conversation,
        kind: "user_prompt".to_string(),
        ts: 1,
        payload: serde_json::json!({ "text": huge }),
        preview: Some("preview".to_string()),
        truncated: None,
        original_bytes: None,
    };

    let truncated = truncate_record(record);
    assert_eq!(truncated.truncated, Some(true));
    assert!(truncated.original_bytes.unwrap_or(0) > MAX_AGENT_EVENT_BYTES as u64);

    let bytes = serde_json::to_vec(&truncated).expect("serialize");
    assert!(bytes.len() <= MAX_AGENT_EVENT_BYTES);
}

// 场景：事件的 payload、preview、id 和 run_id 同时异常膨胀。
// 预期：writer 写出的最终 JSONL 行（含换行）不超过 64 KiB；不变量：持久化边界不能被字段组合绕过。
#[test]
fn file_writer_enforces_final_line_limit() {
    let root = TempDir::new().expect("tempdir");
    let runs_dir = root.path().join("runs");
    let writer = FileAgentEventWriter::new(&runs_dir, "run-limit").expect("writer");
    writer
        .write(AgentEventRecord {
            id: "i".repeat(MAX_AGENT_EVENT_BYTES),
            seq: None,
            run_id: "r".repeat(MAX_AGENT_EVENT_BYTES),
            turn: 0,
            phase: AgentPhase::PreLlm,
            channel: AgentChannel::Trace,
            kind: "kind".into(),
            ts: 1,
            payload: serde_json::json!({"body": "x".repeat(MAX_AGENT_EVENT_BYTES)}),
            preview: Some("p".repeat(MAX_AGENT_EVENT_BYTES)),
            truncated: None,
            original_bytes: None,
        })
        .expect("write bounded event");

    let raw = std::fs::read_to_string(writer.path()).expect("read event log");
    let line = raw.lines().next().expect("event line");
    assert!(line.len() < MAX_AGENT_EVENT_BYTES);
}

// 场景：writer 在同一 active JSONL 文件被关闭后重新打开并继续写入。
// 预期：新 writer 从已有最大 seq 后继续；不变量：同一 run 的 seq 单调不重复。
#[test]
fn file_writer_resumes_sequence_from_existing_file() {
    let root = TempDir::new().expect("tempdir");
    let runs_dir = root.path().join("runs");
    let record = || AgentEventRecord {
        id: "event-1".into(),
        seq: None,
        run_id: "run-seq".into(),
        turn: 0,
        phase: AgentPhase::PreLlm,
        channel: AgentChannel::Trace,
        kind: "turn_started".into(),
        ts: 1,
        payload: serde_json::json!({"turn": 0}),
        preview: None,
        truncated: None,
        original_bytes: None,
    };

    let first = FileAgentEventWriter::new(&runs_dir, "run-seq").expect("first writer");
    first.write(record()).expect("first write");
    drop(first);

    let second = FileAgentEventWriter::new(&runs_dir, "run-seq").expect("second writer");
    second.write(record()).expect("second write");

    let lines = read_agent_event_lines(second.path());
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["seq"], 0);
    assert_eq!(lines[1]["seq"], 1);
}

fn integration_dirs(root: &TempDir) -> (PathBuf, PathBuf) {
    let sessions = root.path().join("sessions");
    let runs = root.path().join("runs");
    (sessions, runs)
}

fn integration_dispatcher(
    runs_dir: &PathBuf,
    run_id: &str,
    session_id: &str,
    store: SessionStore,
    extra_hooks: Vec<Arc<dyn HookHandler>>,
) -> EventDispatcher {
    let writer = FileAgentEventWriter::new(runs_dir, run_id).expect("writer");
    let mut builder = PipelineRegistry::builder()
        .commit(Arc::new(SessionCommitHandler::new(store)))
        .observe(Arc::new(DeriveObserveHandler::new(writer)));
    for hook in extra_hooks {
        builder = builder.hook(hook);
    }
    let registry = builder.build_frozen().expect("registry");
    EventDispatcher::new(registry, TraceContext::new(run_id, session_id))
}

fn read_agent_event_lines(path: &Path) -> Vec<serde_json::Value> {
    let raw = std::fs::read_to_string(path).expect("read agent events");
    raw.lines()
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).expect("parse agent event line"))
        .collect()
}

// 场景：生产 dispatcher 提交用户输入并写 Agent Event Log。
// 预期：Session Item Log 与观测 JSONL 各产生一条对应事实。
#[test]
fn integration_user_prompt_commits_session_and_writes_agent_event() {
    let root = TempDir::new().expect("tempdir");
    let (sessions_dir, runs_dir) = integration_dirs(&root);
    let run_id = "run-user-prompt";
    let store = SessionStore::create(&sessions_dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();

    let mut dispatcher = integration_dispatcher(&runs_dir, run_id, &session_id, store, vec![]);

    dispatcher
        .emit(RunEvent::UserPromptCommitted {
            turn: 0,
            text: "hello integration".into(),
        })
        .expect("emit");

    let loaded = SessionStore::load(&sessions_dir, &session_id).expect("load session");
    assert_eq!(loaded.items().len(), 1);
    match &loaded.items()[0] {
        SessionItem::UserMessage { text, .. } => assert_eq!(text, "hello integration"),
        other => panic!("expected user message, got {other:?}"),
    }

    let event_path = runs_dir.join(format!("{run_id}.active.jsonl"));
    let lines = read_agent_event_lines(&event_path);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["channel"], "conversation");
    assert_eq!(lines[0]["kind"], "user_prompt");
    assert_eq!(lines[0]["seq"], 0);
    assert_eq!(lines[0]["runId"], run_id);
    assert_eq!(lines[0]["payload"]["text"], "hello integration");
}

// 场景：生产 dispatcher 提交 assistant finalized 事件。
// 预期：Session 保存 AssistantMessage，观测日志保存 conversation/final。
#[test]
fn integration_assistant_finalized_commits_session_and_writes_agent_event() {
    let root = TempDir::new().expect("tempdir");
    let (sessions_dir, runs_dir) = integration_dirs(&root);
    let run_id = "run-assistant";
    let store = SessionStore::create(&sessions_dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();

    let mut dispatcher = integration_dispatcher(&runs_dir, run_id, &session_id, store, vec![]);

    dispatcher
        .emit(RunEvent::AssistantFinalized {
            turn: 1,
            blocks: vec![ContentBlock::Text {
                text: "final answer".into(),
            }],
        })
        .expect("emit");

    let loaded = SessionStore::load(&sessions_dir, &session_id).expect("load session");
    assert_eq!(loaded.items().len(), 1);
    match &loaded.items()[0] {
        SessionItem::AssistantMessage { blocks, .. } => {
            assert_eq!(blocks.len(), 1);
        }
        other => panic!("expected assistant message, got {other:?}"),
    }

    let event_path = runs_dir.join(format!("{run_id}.active.jsonl"));
    let lines = read_agent_event_lines(&event_path);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["channel"], "conversation");
    assert_eq!(lines[0]["kind"], "final");
    assert_eq!(lines[0]["seq"], 0);
    assert_eq!(lines[0]["payload"]["text"], "final answer");
}

// 场景：生产 hook 阻断用户输入事件。
// 预期：Session 与 Agent Event Log 都不写入；不变量：阻断不产生副作用。
#[test]
fn integration_hook_block_skips_commit_and_agent_event_write() {
    let root = TempDir::new().expect("tempdir");
    let (sessions_dir, runs_dir) = integration_dirs(&root);
    let run_id = "run-blocked";
    let store = SessionStore::create(&sessions_dir, PathBuf::from("/tmp")).expect("create");
    let session_id = store.header().session_id.clone();

    let mut dispatcher = integration_dispatcher(
        &runs_dir,
        run_id,
        &session_id,
        store,
        vec![Arc::new(BlockingHook)],
    );

    dispatcher
        .emit(RunEvent::UserPromptCommitted {
            turn: 0,
            text: "blocked".into(),
        })
        .expect("emit");

    let loaded = SessionStore::load(&sessions_dir, &session_id).expect("load session");
    assert!(loaded.items().is_empty());

    let event_path = runs_dir.join(format!("{run_id}.active.jsonl"));
    assert!(
        !event_path.exists(),
        "agent event log should not be created when hook blocks"
    );
}
