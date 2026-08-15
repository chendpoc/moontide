use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};

use crate::event::{
    CommitHandler, EventDispatcher, HookHandler, HookOutcome, ObserveHandler, PipelineRegistry,
    RunEvent, TraceContext,
};
use crate::llm::protocol::ContentBlock;

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
