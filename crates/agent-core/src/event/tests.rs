use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};

use crate::event::{
    derive_agent_event, AgentChannel, AgentEventRecord, AgentEventRecorder, AgentPhase,
    CommitHandler, DeriveAgentEventHook, EventDispatcher, HookHandler, LlmCallOutcome,
    PipelineRegistry, TraceContext, TurnEvent,
};
use crate::llm::protocol::{ContentBlock, ModelResponseSnapshot, PendingBlock, StopReason, Usage};
use crate::tools::{ToolCall, ToolContent, ToolResult};

struct MockCommitHandler {
    calls: Arc<AtomicUsize>,
}

impl MockCommitHandler {
    fn new(calls: Arc<AtomicUsize>) -> Self {
        Self { calls }
    }
}

impl CommitHandler for MockCommitHandler {
    fn commit(&mut self, _event: &TurnEvent) -> Result<Option<String>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Some("item-1".to_string()))
    }
}

struct FailingHook;

impl HookHandler for FailingHook {
    fn on_event(&self, _ctx: &TraceContext, _event: &TurnEvent) -> Result<()> {
        Err(anyhow!("hook failed"))
    }
}

struct RecordingHook {
    events: Arc<Mutex<Vec<TurnEvent>>>,
}

impl RecordingHook {
    fn new(events: Arc<Mutex<Vec<TurnEvent>>>) -> Self {
        Self { events }
    }
}

struct RecordingAgentEventRecorder {
    records: Arc<Mutex<Vec<AgentEventRecord>>>,
}

impl AgentEventRecorder for RecordingAgentEventRecorder {
    fn append(&self, record: AgentEventRecord) -> Result<()> {
        self.records
            .lock()
            .map_err(|_| anyhow!("append lock poisoned"))?
            .push(record);
        Ok(())
    }
}

impl HookHandler for RecordingHook {
    fn on_event(&self, _ctx: &TraceContext, event: &TurnEvent) -> Result<()> {
        self.events
            .lock()
            .map_err(|_| anyhow!("observe lock poisoned"))?
            .push(event.clone());
        Ok(())
    }
}

fn test_dispatcher(extra_hooks: Vec<Arc<dyn HookHandler>>) -> EventDispatcher {
    let mut builder = PipelineRegistry::builder();
    for hook in extra_hooks {
        builder = builder.hook(hook);
    }
    let registry = builder.build_frozen().expect("registry");
    EventDispatcher::new(registry, TraceContext::new("run-1", "session-1"))
}

// 场景：可提交的 TurnEvent 进入 dispatcher。
// 预期：commit handler 执行一次并回填 session item id；不变量：先 commit 再 observe。
#[test]
fn committable_event_triggers_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(vec![]);
    let mut commit = MockCommitHandler::new(Arc::clone(&commit_calls));

    dispatcher
        .emit(
            &mut commit,
            TurnEvent::UserPromptCommitted {
                turn: 1,
                text: "hello".to_string(),
            },
        )
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        dispatcher.trace().session_item_id.as_deref(),
        Some("item-1")
    );
}

// 场景：观测类 TurnEvent 进入 dispatcher。
// 预期：不会调用 commit handler，也不会产生 session item id。
#[test]
fn observational_event_skips_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(vec![]);
    let mut commit = MockCommitHandler::new(Arc::clone(&commit_calls));

    dispatcher
        .emit(&mut commit, TurnEvent::TurnStarted { turn: 1 })
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 0);
    assert!(dispatcher.trace().session_item_id.is_none());
}

// 场景：一个 committable event 之后紧跟 observational event。
// 预期：新的 event 不继承旧 session item/tool/llm identity；不变量：transient TraceContext 字段只属于当前 emit。
#[test]
fn transient_trace_identity_is_cleared_per_emit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(vec![]);
    let mut commit = MockCommitHandler::new(Arc::clone(&commit_calls));

    dispatcher
        .emit(
            &mut commit,
            TurnEvent::ToolCallRecorded {
                turn: 1,
                call: ToolCall::new("tool-1", "grep", serde_json::json!({})).expect("tool call"),
            },
        )
        .expect("tool event");
    assert_eq!(dispatcher.trace().tool_use_id.as_deref(), Some("tool-1"));
    assert_eq!(
        dispatcher.trace().session_item_id.as_deref(),
        Some("item-1")
    );

    dispatcher
        .emit(&mut commit, TurnEvent::TurnStarted { turn: 2 })
        .expect("turn started");
    assert!(dispatcher.trace().session_item_id.is_none());
    assert!(dispatcher.trace().tool_use_id.is_none());
    assert!(dispatcher.trace().llm_call_id.is_none());
}

// 场景：post-commit hook 返回错误。
// 预期：commit 仍执行且 emit 成功；不变量：Hook 不能阻断事实提交或改变 dispatch 结果。
#[test]
fn hook_failure_does_not_skip_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let mut dispatcher = test_dispatcher(vec![Arc::new(FailingHook)]);
    let mut commit = MockCommitHandler::new(Arc::clone(&commit_calls));

    dispatcher
        .emit(
            &mut commit,
            TurnEvent::UserPromptCommitted {
                turn: 1,
                text: "blocked".to_string(),
            },
        )
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        dispatcher.trace().session_item_id.as_deref(),
        Some("item-1")
    );
}

// 场景：第一个 Hook 返回错误，后续 Hook 仍可运行。
// 预期：Hook fail-open；不变量：观测错误不阻断 dispatcher。
#[test]
fn hook_fail_open_continues_dispatch() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let observed = Arc::new(Mutex::new(Vec::new()));
    let mut dispatcher = test_dispatcher(vec![
        Arc::new(FailingHook),
        Arc::new(RecordingHook::new(Arc::clone(&observed))),
    ]);
    let mut commit = MockCommitHandler::new(Arc::clone(&commit_calls));

    dispatcher
        .emit(&mut commit, TurnEvent::TurnStarted { turn: 2 })
        .expect("emit");

    let events = observed.lock().expect("lock");
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], TurnEvent::TurnStarted { turn: 2 }));
}

// 场景：可提交事件同时配置 commit 和 post-commit Hook。
// 预期：Hook 在 commit 之后收到事件；不变量：commit 顺序稳定。
#[test]
fn committable_runs_hook_after_commit() {
    let commit_calls = Arc::new(AtomicUsize::new(0));
    let observed = Arc::new(Mutex::new(Vec::new()));
    let mut dispatcher = test_dispatcher(vec![Arc::new(RecordingHook::new(Arc::clone(&observed)))]);
    let mut commit = MockCommitHandler::new(Arc::clone(&commit_calls));

    dispatcher
        .emit(
            &mut commit,
            TurnEvent::AssistantFinalized {
                turn: 1,
                llm_call_id: "call-1".into(),
                blocks: vec![ContentBlock::Text {
                    text: "done".to_string(),
                }],
            },
        )
        .expect("emit");

    assert_eq!(commit_calls.load(Ordering::SeqCst), 1);
    let events = observed.lock().expect("lock");
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0], TurnEvent::AssistantFinalized { .. }));
}

fn test_ctx() -> TraceContext {
    TraceContext::new("run-derive", "session-derive")
}

fn derive_record(ctx: &TraceContext, event: &TurnEvent) -> AgentEventRecord {
    derive_agent_event(ctx, event)
        .expect("derive agent event")
        .expect("event should produce a persisted observation")
}

// 场景：用户消息事件派生为 conversation/user_prompt。
// 预期：channel、kind、phase 和 payload 保持事件语义。
#[test]
fn derive_user_prompt_committed_maps_conversation() {
    let ctx = test_ctx();
    let record = derive_record(
        &ctx,
        &TurnEvent::UserPromptCommitted {
            turn: 1,
            text: "hello world".to_string(),
        },
    );

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

    let started = derive_record(&ctx, &TurnEvent::TurnStarted { turn: 3 });
    assert_eq!(started.channel, AgentChannel::Trace);
    assert_eq!(started.kind, "turn_started");
    assert_eq!(started.phase, AgentPhase::PreLlm);
    assert_eq!(started.turn, 3);

    let ended = derive_record(&ctx, &TurnEvent::TurnEnded { turn: 3 });
    assert_eq!(ended.channel, AgentChannel::Trace);
    assert_eq!(ended.kind, "turn_ended");
    assert_eq!(ended.phase, AgentPhase::Stop);
}

// 场景：同一个 LLM call 的开始与结束事件进行派生。
// 预期：保留 call id、状态和 usage；不变量：仍属于 trace channel。
#[test]
fn derive_llm_call_started_and_ended_maps_trace() {
    let ctx = test_ctx();

    let started = derive_record(
        &ctx,
        &TurnEvent::LlmCallStarted {
            turn: 2,
            step: 1,
            llm_call_id: "call-1".to_string(),
        },
    );
    assert_eq!(started.channel, AgentChannel::Trace);
    assert_eq!(started.kind, "llm_call");
    assert_eq!(started.payload["status"], "started");
    assert_eq!(started.payload["llmCallId"], "call-1");

    let ended = derive_record(
        &ctx,
        &TurnEvent::LlmCallEnded {
            turn: 2,
            step: 1,
            llm_call_id: "call-1".to_string(),
            outcome: LlmCallOutcome::Succeeded {
                stop_reason: StopReason::EndTurn,
                usage: Some(Usage {
                    input_tokens: 10,
                    output_tokens: 5,
                }),
            },
        },
    );
    assert_eq!(ended.channel, AgentChannel::Trace);
    assert_eq!(ended.kind, "llm_call");
    assert_eq!(ended.payload["status"], "ended");
    assert_eq!(ended.payload["outcome"]["status"], "succeeded");
    assert_eq!(ended.payload["outcome"]["usage"]["input_tokens"], 10);
}

// 场景：流式 snapshot 只有 pending text，没有最终 content。
// 预期：派生为 assistant_text，并保留正文和字符数。
#[test]
fn derive_message_update_pending_text_maps_assistant_text() {
    let ctx = test_ctx();
    let record = derive_record(
        &ctx,
        &TurnEvent::MessageUpdate {
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
    );

    assert_eq!(record.channel, AgentChannel::Trace);
    assert_eq!(record.kind, "assistant_text");
    assert_eq!(record.payload["body"], "partial");
    assert_eq!(record.payload["charCount"], 7);
}

// 场景：流式 snapshot 携带尚未提交的 Unicode tool input；预期：使用独立的 trace/tool_use_update schema 并按字符计数；不变量/副作用：流式观测不能冒充已提交的 ToolCall 事实。
#[test]
fn derive_message_update_separates_partial_tool_use_from_committed_call() {
    let input_json = r#"{ "pattern": "\u5de5\u5177" }"#;
    let expected_input = serde_json::json!({ "pattern": "工具" });
    let persisted_input =
        serde_json::to_string(&expected_input).expect("serialize persisted input");
    let record = derive_record(
        &test_ctx(),
        &TurnEvent::MessageUpdate {
            turn: 1,
            step: 2,
            llm_call_id: "llm-call-1".to_owned(),
            snapshot: ModelResponseSnapshot {
                content: vec![],
                pending: Some(PendingBlock::ToolUse {
                    id: "tool-stream-1".to_owned(),
                    name: "grep".to_owned(),
                    input_json: input_json.to_owned(),
                }),
                stop_reason: None,
                usage: None,
                model: None,
            },
        },
    );

    assert_eq!(record.kind, "tool_use_update");
    assert_eq!(
        record.payload,
        serde_json::json!({
            "toolName": "grep",
            "toolUseId": "tool-stream-1",
            "charCount": persisted_input.chars().count(),
            "input": expected_input,
            "llmCallId": "llm-call-1",
            "step": 2,
        })
    );
}

// 场景：流式 tool input 仍是无效 partial JSON；预期：payload 将原文持久化为 JSON string，并按该最终 string 的紧凑 JSON 表示计数；不变量/副作用：charCount 不依赖无法持久化的原始字节形状。
#[test]
fn derive_message_update_counts_persisted_invalid_partial_input() {
    let input_json = r#"{"pattern":"工具""#;
    let persisted_input = serde_json::to_string(input_json).expect("serialize persisted input");
    let record = derive_record(
        &test_ctx(),
        &TurnEvent::MessageUpdate {
            turn: 1,
            step: 2,
            llm_call_id: "llm-call-invalid".to_owned(),
            snapshot: ModelResponseSnapshot {
                content: vec![],
                pending: Some(PendingBlock::ToolUse {
                    id: "tool-stream-invalid".to_owned(),
                    name: "grep".to_owned(),
                    input_json: input_json.to_owned(),
                }),
                stop_reason: None,
                usage: None,
                model: None,
            },
        },
    );

    assert_eq!(record.kind, "tool_use_update");
    assert_eq!(record.payload["input"], input_json);
    assert_eq!(record.payload["charCount"], persisted_input.chars().count());
}

// 场景：流式 snapshot 已形成完整 ToolUse block 但尚未产生 ToolCallRecorded；预期：仍使用 tool_use_update，并输出与 committed schema 区分的 llmCallId/step；不变量/副作用：snapshot 完整不等于调用事实已提交。
#[test]
fn derive_message_update_completed_tool_block_remains_update() {
    let input = serde_json::json!({ "path": "文档.md" });
    let input_json = serde_json::to_string(&input).expect("serialize expected input");
    let record = derive_record(
        &test_ctx(),
        &TurnEvent::MessageUpdate {
            turn: 1,
            step: 3,
            llm_call_id: "llm-call-2".to_owned(),
            snapshot: ModelResponseSnapshot {
                content: vec![ContentBlock::ToolUse {
                    id: "tool-stream-2".to_owned(),
                    name: "read_file".to_owned(),
                    input: input.clone(),
                }],
                pending: None,
                stop_reason: None,
                usage: None,
                model: None,
            },
        },
    );

    assert_eq!(record.kind, "tool_use_update");
    assert_eq!(record.payload["input"], input);
    assert_eq!(record.payload["charCount"], input_json.chars().count());
    assert_eq!(record.payload["llmCallId"], "llm-call-2");
    assert_eq!(record.payload["step"], 3);
}

// 场景：assistant 最终消息包含 text 与 thinking blocks。
// 预期：派生为 conversation/final，正文来自最终 text block。
#[test]
fn derive_assistant_finalized_maps_conversation_final() {
    let ctx = test_ctx();
    let record = derive_record(
        &ctx,
        &TurnEvent::AssistantFinalized {
            turn: 1,
            llm_call_id: "call-1".into(),
            blocks: vec![
                ContentBlock::Text {
                    text: "hello".to_string(),
                },
                ContentBlock::Thinking {
                    thinking: "hmm".to_string(),
                },
            ],
        },
    );

    assert_eq!(record.channel, AgentChannel::Conversation);
    assert_eq!(record.kind, "final");
    assert_eq!(record.payload["text"], "hello");
}

// 场景：ToolResult 携带工具名称、调用 ID、状态和文本结果；预期：trace/tool_result payload 完整保留这些语义；不变量/副作用：观测日志直接读取 ToolResult，不复制另一套结果结构。
#[test]
fn derive_tool_result_includes_identity_status_and_content() {
    let call = ToolCall::new("tool-1", "read_file", serde_json::json!({"path": "a.rs"}))
        .expect("create tool call");
    let record = derive_record(
        &test_ctx(),
        &TurnEvent::ToolResultRecorded {
            turn: 1,
            result: ToolResult::succeeded(&call, ToolContent::Text("ok".into())),
        },
    );

    assert_eq!(record.channel, AgentChannel::Trace);
    assert_eq!(record.kind, "tool_result");
    assert_eq!(
        record.payload,
        serde_json::json!({
            "toolName": "read_file",
            "toolUseId": "tool-1",
            "status": "succeeded",
            "content": {"type": "text", "value": "ok"},
            "body": "ok",
            "charCount": 2,
        })
    );
}

// 场景：ToolCall 进入 Agent Event 派生边界；预期：tool_use payload 保留名称、调用 ID 与原始 input；不变量/副作用：派生过程只读 ToolCall，不重新建模或改写输入。
#[test]
fn derive_tool_call_reuses_canonical_call_payload() {
    let call = ToolCall::new("tool-2", "grep", serde_json::json!({"pattern": "工具"}))
        .expect("create tool call");

    let record = derive_record(
        &test_ctx(),
        &TurnEvent::ToolCallRecorded {
            turn: 2,
            call: call.clone(),
        },
    );

    let input_json = serde_json::to_string(call.input()).expect("serialize expected input");
    assert_eq!(
        record.payload,
        serde_json::json!({
            "toolName": call.name(),
            "toolUseId": call.tool_use_id(),
            "charCount": input_json.chars().count(),
            "input": call.input(),
        })
    );
}

// 场景：post-commit Agent Event hook 将一个大 payload 的语义事件交给 recorder。
// 预期：hook 原样转交 derive 结果，不提前执行文件 JSONL 截断；文件策略只由文件 recorder 负责。
#[test]
fn derive_agent_event_hook_forwards_record_without_file_truncation() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let handler = DeriveAgentEventHook::new(RecordingAgentEventRecorder {
        records: Arc::clone(&records),
    });
    let text = "x".repeat(70_000);

    handler
        .on_event(
            &test_ctx(),
            &TurnEvent::UserPromptCommitted {
                turn: 1,
                text: text.clone(),
            },
        )
        .expect("forward record");

    let records = records.lock().expect("read recorded events");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].truncated, None);
    assert_eq!(records[0].payload["text"].as_str(), Some(text.as_str()));
}
