use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use tempfile::TempDir;

use crate::event::{
    derive_agent_event, truncate_record, AgentChannel, AgentEventRecord, AgentPhase, CommitHandler,
    DeriveObserveHandler, EventDispatcher, FileAgentEventWriter, HookHandler, HookOutcome,
    ObserveHandler, PipelineRegistry, RunEvent, TraceContext, MAX_AGENT_EVENT_BYTES,
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

#[test]
fn truncate_record_enforces_64kib_limit() {
    let huge = "x".repeat(MAX_AGENT_EVENT_BYTES);
    let record = AgentEventRecord {
        id: "id-1".to_string(),
        seq: None,
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

fn read_agent_event_lines(path: &PathBuf) -> Vec<serde_json::Value> {
    let raw = std::fs::read_to_string(path).expect("read agent events");
    raw.lines()
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).expect("parse agent event line"))
        .collect()
}

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
