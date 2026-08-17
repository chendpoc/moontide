use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures::stream;
use tempfile::tempdir;

use crate::{
    event::{EventDispatcher, HookHandler, PipelineRegistry, TraceContext, TurnEvent},
    llm::{
        protocol::{ContentBlock, LlmError, ModelResponse, ModelStreamEvent, StopReason},
        LLMProvider,
    },
    model_input::{ModelRequestConfig, SystemPrompt},
    session::{SessionItemDraft, SessionStore},
    tools::{
        Tool, ToolCall, ToolContent, ToolExecutor, ToolRegistry, ToolResult, ToolResultStatus,
        ToolSpec,
    },
};

use super::response::terminal_assistant_blocks;
use super::{
    AgentLoop, AgentLoopInit, ToolApproval, ToolPermission, ToolPermissionMap, ToolRuntime,
    TurnInput, TurnPolicy,
};

struct MockProvider {
    events: Script,
}

type StreamResult = Result<ModelStreamEvent, LlmError>;
type Script = Vec<StreamResult>;

struct QueuedProvider {
    scripts: Arc<Mutex<VecDeque<Script>>>,
}

struct PendingProvider;

impl LLMProvider for PendingProvider {
    fn stream(
        &self,
        _request: crate::llm::protocol::ModelRequest,
    ) -> Pin<Box<dyn futures::Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        Box::pin(futures::stream::pending())
    }
}

impl LLMProvider for QueuedProvider {
    fn stream(
        &self,
        _request: crate::llm::protocol::ModelRequest,
    ) -> Pin<Box<dyn futures::Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>> {
        let events = self
            .scripts
            .lock()
            .expect("provider scripts lock")
            .pop_front()
            .expect("queued provider script");
        Box::pin(stream::iter(events))
    }
}

impl LLMProvider for MockProvider {
    fn stream(
        &self,
        _request: crate::llm::protocol::ModelRequest,
    ) -> Pin<
        Box<
            dyn futures::Stream<Item = Result<ModelStreamEvent, crate::llm::protocol::LlmError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(stream::iter(self.events.clone()))
    }
}

struct NoopExecutor;

impl ToolExecutor for NoopExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a crate::tools::ToolCall,
        _working_dir: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            Ok(ToolResult::succeeded(
                call,
                crate::tools::ToolContent::Text("ok".into()),
            ))
        })
    }
}

struct RecordingExecutor {
    calls: Arc<Mutex<Vec<String>>>,
    fail: bool,
}

impl ToolExecutor for RecordingExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        _working_dir: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            self.calls
                .lock()
                .expect("executor calls lock")
                .push(call.name().to_owned());
            if self.fail {
                anyhow::bail!("executor failed for {}", call.name());
            }
            Ok(ToolResult::succeeded(
                call,
                ToolContent::Text(format!("{} ok", call.name())),
            ))
        })
    }
}

struct ExpectedFailureExecutor;

impl ToolExecutor for ExpectedFailureExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        _working_dir: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            Ok(ToolResult::failed(
                call,
                ToolContent::Text("expected failure".into()),
                true,
            ))
        })
    }
}

struct UnknownOutcomeExecutor;

impl ToolExecutor for UnknownOutcomeExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        _working_dir: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            Ok(ToolResult::outcome_unknown(
                call,
                ToolContent::Text("executor cannot determine the side effect".into()),
            ))
        })
    }
}

struct PendingExecutor;

impl ToolExecutor for PendingExecutor {
    fn execute<'a>(
        &'a self,
        _call: &'a ToolCall,
        _working_dir: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<ToolResult>> + Send + 'a>> {
        Box::pin(async { std::future::pending().await })
    }
}

struct CancelOnEventHook {
    token: tokio_util::sync::CancellationToken,
    cancel_on_tool_call: bool,
    cancel_on_assistant: bool,
}

impl HookHandler for CancelOnEventHook {
    fn on_event(&self, _ctx: &TraceContext, event: &TurnEvent) -> anyhow::Result<()> {
        if (self.cancel_on_tool_call && matches!(event, TurnEvent::ToolCallRecorded { .. }))
            || (self.cancel_on_assistant && matches!(event, TurnEvent::AssistantFinalized { .. }))
        {
            self.token.cancel();
        }
        Ok(())
    }
}

#[derive(Clone)]
struct FixedApproval {
    outcome: ToolApproval,
}

impl super::ToolApprovalHandler for FixedApproval {
    fn request<'a>(
        &'a self,
        _call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<super::ToolApproval>> + Send + 'a>> {
        let outcome = self.outcome.clone();
        Box::pin(async move { Ok(outcome) })
    }
}

struct FailingApproval;

impl super::ToolApprovalHandler for FailingApproval {
    fn request<'a>(
        &'a self,
        _call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<super::ToolApproval>> + Send + 'a>> {
        Box::pin(async { anyhow::bail!("approval unavailable") })
    }
}

struct PendingApproval;

impl super::ToolApprovalHandler for PendingApproval {
    fn request<'a>(
        &'a self,
        _call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<super::ToolApproval>> + Send + 'a>> {
        Box::pin(async { std::future::pending().await })
    }
}

fn test_runtime(permission: ToolPermission) -> ToolRuntime {
    let spec = crate::tools::ToolSpec::new("noop", "no-op", serde_json::json!({"type": "object"}))
        .expect("valid spec");
    let registry =
        ToolRegistry::new(vec![Tool::new(spec, Arc::new(NoopExecutor))]).expect("valid registry");
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("noop".into(), permission);
    ToolRuntime::new(registry, permissions, None)
        .unwrap_or_else(|_| panic!("allow runtime should be constructible"))
}

fn terminal_input() -> TurnInput {
    TurnInput {
        text: "hi".into(),
        config: ModelRequestConfig {
            model: "mock".into(),
            max_tokens: 32,
            thinking_level: None,
            session_id: Some("session".into()),
        },
        system_prompt: SystemPrompt::new("system"),
        policy: TurnPolicy::new(1).expect("policy"),
    }
}

fn tool_with_executor(
    name: &str,
    schema: serde_json::Value,
    calls: Arc<Mutex<Vec<String>>>,
    fail: bool,
) -> Tool {
    let spec = ToolSpec::new(name, name, schema).expect("tool spec");
    Tool::new(spec, Arc::new(RecordingExecutor { calls, fail }))
}

fn build_loop(
    dir: &tempfile::TempDir,
    provider: Arc<dyn LLMProvider>,
    tools: Vec<Tool>,
    permissions: ToolPermissionMap,
    approval: Option<Arc<dyn super::ToolApprovalHandler>>,
) -> (AgentLoop, String) {
    build_loop_with_hooks(dir, provider, tools, permissions, approval, Vec::new())
}

fn build_loop_with_hooks(
    dir: &tempfile::TempDir,
    provider: Arc<dyn LLMProvider>,
    tools: Vec<Tool>,
    permissions: ToolPermissionMap,
    approval: Option<Arc<dyn super::ToolApprovalHandler>>,
    hooks: Vec<Arc<dyn HookHandler>>,
) -> (AgentLoop, String) {
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let runtime = ToolRuntime::new(
        ToolRegistry::new(tools).expect("tool registry"),
        permissions,
        approval,
    )
    .expect("tool runtime");
    let mut builder = PipelineRegistry::builder();
    for hook in hooks {
        builder = builder.hook(hook);
    }
    let events = EventDispatcher::new(
        builder.build_frozen().expect("pipeline"),
        TraceContext::new("legacy-run", &session_id),
    );
    (
        AgentLoop::new(AgentLoopInit {
            session,
            provider,
            tools: runtime,
            events,
        }),
        session_id,
    )
}

fn tool_use_script(calls: &[(&str, serde_json::Value)]) -> Vec<Result<ModelStreamEvent, LlmError>> {
    calls
        .iter()
        .flat_map(|(name, input)| {
            let id = format!("{name}-id");
            [
                Ok(ModelStreamEvent::ToolUseStarted {
                    id: id.clone(),
                    name: (*name).into(),
                }),
                Ok(ModelStreamEvent::ToolUseFinished {
                    id,
                    name: (*name).into(),
                    input: input.clone(),
                }),
            ]
        })
        .chain([Ok(ModelStreamEvent::Finished {
            stop_reason: StopReason::ToolUse,
            usage: None,
        })])
        .collect()
}

fn terminal_script(text: &str) -> Vec<Result<ModelStreamEvent, LlmError>> {
    vec![
        Ok(ModelStreamEvent::TextPart {
            block_index: 0,
            text: text.into(),
        }),
        Ok(ModelStreamEvent::Finished {
            stop_reason: StopReason::EndTurn,
            usage: None,
        }),
    ]
}

// 场景：TurnPolicy 使用零步数或超过 R1 retry 上限构造。
// 预期：构造器拒绝零步数，turn 入口策略校验拒绝超过三次 retry；不变量：R1 不产生无界 retry policy。
#[test]
fn turn_policy_enforces_r1_bounds() {
    assert!(TurnPolicy::new(0).is_err());
    let mut policy = TurnPolicy::new(1).expect("positive steps should be valid");
    assert_eq!(policy.max_llm_retries, 3);
    policy.max_llm_retries = 4;
    assert!(policy.validate().is_err());
}

// 场景：permission map 与 registry 不一致，或 Ask 缺少 approval handler。
// 预期：ToolRuntime 构造失败；不变量：未知工具和无审批端口不能进入 loop。
#[test]
fn tool_runtime_rejects_invalid_permission_configuration() {
    let spec = crate::tools::ToolSpec::new("noop", "no-op", serde_json::json!({"type": "object"}))
        .expect("valid spec");
    let registry =
        ToolRegistry::new(vec![Tool::new(spec, Arc::new(NoopExecutor))]).expect("valid registry");
    let mut missing = ToolPermissionMap::new();
    missing.insert("other".into(), ToolPermission::Allow);
    assert!(ToolRuntime::new(registry, missing, None).is_err());

    let spec = crate::tools::ToolSpec::new("noop", "no-op", serde_json::json!({"type": "object"}))
        .expect("valid spec");
    let registry =
        ToolRegistry::new(vec![Tool::new(spec, Arc::new(NoopExecutor))]).expect("valid registry");
    let mut ask = ToolPermissionMap::new();
    ask.insert("noop".into(), ToolPermission::Ask);
    assert!(ToolRuntime::new(registry, ask, None).is_err());
}

// 场景：terminal stop reason 与 response content 组合合法或非法。
// 预期：Text/Thinking 可持久化；ToolUse/ToolResult payload 被拒绝；不变量：R1 terminal path 不执行工具。
#[test]
fn terminal_response_shape_is_validated() {
    for stop_reason in [StopReason::MaxTokens, StopReason::Other("done".into())] {
        let response = ModelResponse {
            content: vec![ContentBlock::Text { text: "ok".into() }],
            stop_reason,
            usage: None,
            model: Some("mock".into()),
        };
        assert!(terminal_assistant_blocks(&response).is_ok());
    }

    let tool_use_response = ModelResponse {
        content: vec![ContentBlock::ToolUse {
            id: "tool-1".into(),
            name: "noop".into(),
            input: serde_json::json!({}),
        }],
        stop_reason: StopReason::EndTurn,
        usage: None,
        model: None,
    };
    assert!(terminal_assistant_blocks(&tool_use_response).is_err());

    let tool_result_response = ModelResponse {
        content: vec![ContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: crate::llm::protocol::ToolResultContent::Text("ok".into()),
        }],
        stop_reason: StopReason::EndTurn,
        usage: None,
        model: None,
    };
    assert!(terminal_assistant_blocks(&tool_result_response).is_err());
}

// 场景：一个 ToolUse response 含两个允许的 calls，provider 下一次返回 terminal response。
// 预期：全部 ToolCall 先落盘，再按模型顺序执行并提交结果，随后进入下一 Step；不变量：call/result 顺序和身份配对稳定。
#[tokio::test]
async fn tool_round_records_calls_before_sequential_execution() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        tool_use_script(&[
            ("first", serde_json::json!({})),
            ("second", serde_json::json!({})),
        ]),
        terminal_script("done"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("first".into(), ToolPermission::Allow);
    permissions.insert("second".into(), ToolPermission::Allow);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![
            tool_with_executor(
                "first",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
            tool_with_executor(
                "second",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
        ],
        permissions,
        None,
    );
    let mut input = terminal_input();
    input.policy.max_steps = 2;

    agent_loop
        .turn(input, tokio_util::sync::CancellationToken::new())
        .await
        .expect("tool round then terminal turn");

    assert_eq!(
        executed.lock().expect("executed lock").as_slice(),
        ["first", "second"]
    );
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert_eq!(stored.items().len(), 6);
    assert!(matches!(
        stored.items()[1],
        crate::session::SessionItem::ToolCall { .. }
    ));
    assert!(matches!(
        stored.items()[2],
        crate::session::SessionItem::ToolCall { .. }
    ));
    assert!(matches!(
        stored.items()[3],
        crate::session::SessionItem::ToolResult { .. }
    ));
    assert!(matches!(
        stored.items()[4],
        crate::session::SessionItem::ToolResult { .. }
    ));
    assert!(matches!(
        stored.items()[5],
        crate::session::SessionItem::AssistantMessage { .. }
    ));
}

// 场景：一个 round 中出现 unknown tool 和 schema-invalid input。
// 预期：分别产生 UnknownTool/InvalidArguments，executor 不调用，下一 Step 仍可继续；不变量：预期调用错误是模型可见结果。
#[tokio::test]
async fn tool_round_maps_unknown_and_invalid_calls_without_side_effects() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        tool_use_script(&[
            ("missing", serde_json::json!({})),
            ("known", serde_json::json!({})),
        ]),
        terminal_script("fixed"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("known".into(), ToolPermission::Allow);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![tool_with_executor(
            "known",
            serde_json::json!({
                "type": "object",
                "required": ["needed"],
                "properties": {"needed": {"type": "string"}}
            }),
            Arc::clone(&executed),
            false,
        )],
        permissions,
        None,
    );
    let mut input = terminal_input();
    input.policy.max_steps = 2;

    agent_loop
        .turn(input, tokio_util::sync::CancellationToken::new())
        .await
        .expect("invalid calls should be recoverable");

    assert!(executed.lock().expect("executed lock").is_empty());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    let statuses = stored
        .items()
        .iter()
        .filter_map(|item| match item {
            crate::session::SessionItem::ToolResult { result, .. } => Some(result.status()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(statuses.contains(&&ToolResultStatus::UnknownTool));
    assert!(statuses.contains(&&ToolResultStatus::InvalidArguments));
}

// 场景：executor 返回预期的 Failed { retryable: true }，provider 下一次返回 terminal response。
// 预期：ToolResult 保留 retryable 状态且下一 Step 继续；不变量：R2 不自动重试同一个 ToolCall。
#[tokio::test]
async fn expected_tool_failure_is_model_visible_and_continues() {
    let dir = tempdir().expect("tempdir");
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        tool_use_script(&[("flaky", serde_json::json!({}))]),
        terminal_script("after failure"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("flaky".into(), ToolPermission::Allow);
    let spec =
        ToolSpec::new("flaky", "flaky", serde_json::json!({"type": "object"})).expect("tool spec");
    let runtime = ToolRuntime::new(
        ToolRegistry::new(vec![Tool::new(spec, Arc::new(ExpectedFailureExecutor))])
            .expect("tool registry"),
        permissions,
        None,
    )
    .expect("tool runtime");
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", &session_id),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });

    agent_loop
        .turn(
            terminal_input_with_steps(2),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect("expected tool failure should continue");
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Failed { retryable: true }
    )));
}

// 场景：executor 以 Ok(ToolResult::OutcomeUnknown) 返回已规范化结果，provider 下一次返回 terminal response。
// 预期：OutcomeUnknown 原样提交且下一 Step 继续；不变量：只有 executor Err 才触发 sibling cleanup。
#[tokio::test]
async fn executor_ok_unknown_result_is_not_fatal() {
    let dir = tempdir().expect("tempdir");
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        tool_use_script(&[("unknown", serde_json::json!({}))]),
        terminal_script("after unknown"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("unknown".into(), ToolPermission::Allow);
    let spec = ToolSpec::new("unknown", "unknown", serde_json::json!({"type": "object"}))
        .expect("tool spec");
    let runtime = ToolRuntime::new(
        ToolRegistry::new(vec![Tool::new(spec, Arc::new(UnknownOutcomeExecutor))])
            .expect("tool registry"),
        permissions,
        None,
    )
    .expect("tool runtime");
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", &session_id),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });

    agent_loop
        .turn(
            terminal_input_with_steps(2),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect("Ok unknown result should continue");
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::OutcomeUnknown
    )));
}

// 场景：Ask permission 的 approval handler 返回 Denied，provider 随后仍可给出 terminal response。
// 预期：产生 Denied result 且不调用 executor；不变量：permission 拒绝是模型可见的可恢复结果。
#[tokio::test]
async fn denied_approval_records_denied_and_continues() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        tool_use_script(&[("ask", serde_json::json!({}))]),
        terminal_script("after denial"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("ask".into(), ToolPermission::Ask);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![tool_with_executor(
            "ask",
            serde_json::json!({"type": "object"}),
            Arc::clone(&executed),
            false,
        )],
        permissions,
        Some(Arc::new(FixedApproval {
            outcome: ToolApproval::Denied {
                reason: "user denied".into(),
            },
        })),
    );

    agent_loop
        .turn(
            terminal_input_with_steps(2),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect("denied approval should continue");
    assert!(executed.lock().expect("executed lock").is_empty());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Denied
    )));
}

// 场景：Ask permission 的 approval handler 返回 Approved。
// 预期：executor 被调用并提交 Succeeded result，下一 Step 继续；不变量：Approved 是唯一进入副作用执行的 Ask 分支。
#[tokio::test]
async fn approved_approval_executes_tool() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        tool_use_script(&[("ask", serde_json::json!({}))]),
        terminal_script("after approval"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("ask".into(), ToolPermission::Ask);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![tool_with_executor(
            "ask",
            serde_json::json!({"type": "object"}),
            Arc::clone(&executed),
            false,
        )],
        permissions,
        Some(Arc::new(FixedApproval {
            outcome: ToolApproval::Approved,
        })),
    );

    agent_loop
        .turn(
            terminal_input_with_steps(2),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect("approved tool should execute");
    assert_eq!(executed.lock().expect("executed lock").as_slice(), ["ask"]);
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Succeeded
    )));
}

fn terminal_input_with_steps(max_steps: u32) -> TurnInput {
    let mut input = terminal_input();
    input.policy.max_steps = max_steps;
    input
}

// 场景：Ask approval 返回 Cancelled，round 仍有一个未开始 sibling。
// 预期：当前 call 为 Cancelled(User)，sibling 为 Cancelled(Parent)，Turn 返回取消错误；不变量：所有已记录 call 均有 result。
#[tokio::test]
async fn cancelled_approval_closes_remaining_calls_with_parent_status() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[
        ("first", serde_json::json!({})),
        ("second", serde_json::json!({})),
    ])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("first".into(), ToolPermission::Ask);
    permissions.insert("second".into(), ToolPermission::Ask);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![
            tool_with_executor(
                "first",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
            tool_with_executor(
                "second",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
        ],
        permissions,
        Some(Arc::new(FixedApproval {
            outcome: ToolApproval::Cancelled,
        })),
    );

    assert!(agent_loop
        .turn(
            terminal_input_with_steps(1),
            tokio_util::sync::CancellationToken::new()
        )
        .await
        .is_err());
    assert!(executed.lock().expect("executed lock").is_empty());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    let statuses = stored
        .items()
        .iter()
        .filter_map(|item| match item {
            crate::session::SessionItem::ToolResult { result, .. } => Some(result.status()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(statuses.iter().any(|status| {
        **status
            == ToolResultStatus::Cancelled {
                reason: crate::tools::ToolCancellationReason::User,
            }
    }));
    assert!(statuses.iter().any(|status| {
        **status
            == ToolResultStatus::Cancelled {
                reason: crate::tools::ToolCancellationReason::Parent,
            }
    }));
}

// 场景：最后一个允许的 Step 返回 ToolUse，round 内所有 calls 都能正常执行。
// 预期：完整提交 ToolResult 后返回 step exhaustion error；不变量：不存在 dangling ToolCall，也不会发起下一次 LLM call。
#[tokio::test]
async fn final_step_tool_round_closes_before_exhaustion_error() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[(
        "only",
        serde_json::json!({}),
    )])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("only".into(), ToolPermission::Allow);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![tool_with_executor(
            "only",
            serde_json::json!({"type": "object"}),
            Arc::clone(&executed),
            false,
        )],
        permissions,
        None,
    );

    let error = agent_loop
        .turn(
            terminal_input_with_steps(1),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect_err("final ToolUse should exhaust steps");
    assert!(error.to_string().contains("max_steps"));
    assert_eq!(executed.lock().expect("executed lock").as_slice(), ["only"]);
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    let call_count = stored
        .items()
        .iter()
        .filter(|item| matches!(item, crate::session::SessionItem::ToolCall { .. }))
        .count();
    let result_count = stored
        .items()
        .iter()
        .filter(|item| matches!(item, crate::session::SessionItem::ToolResult { .. }))
        .count();
    assert_eq!(call_count, 1);
    assert_eq!(result_count, 1);
}

// 场景：approval handler 返回基础设施错误，round 仍有一个未开始 sibling。
// 预期：当前 call 为 Cancelled(Disposed)，sibling 为 Cancelled(Parent)，原错误传播；不变量：cleanup 后不存在未配对 call。
#[tokio::test]
async fn approval_error_closes_remaining_calls_and_propagates() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[
        ("first", serde_json::json!({})),
        ("second", serde_json::json!({})),
    ])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("first".into(), ToolPermission::Ask);
    permissions.insert("second".into(), ToolPermission::Ask);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![
            tool_with_executor(
                "first",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
            tool_with_executor(
                "second",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
        ],
        permissions,
        Some(Arc::new(FailingApproval)),
    );

    let error = agent_loop
        .turn(
            terminal_input_with_steps(1),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect_err("approval error should propagate");
    assert!(error.to_string().contains("approval unavailable"));
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Cancelled {
            reason: crate::tools::ToolCancellationReason::Disposed
        }
    )));
}

// 场景：第一个 executor 返回基础设施错误，round 仍有一个未开始 sibling。
// 预期：当前 call 为 OutcomeUnknown，sibling 为 Cancelled(Parent)，原错误传播；不变量：未知副作用不能伪装成失败。
#[tokio::test]
async fn executor_error_records_unknown_and_parent_cleanup() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[
        ("first", serde_json::json!({})),
        ("second", serde_json::json!({})),
    ])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("first".into(), ToolPermission::Allow);
    permissions.insert("second".into(), ToolPermission::Allow);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![
            tool_with_executor(
                "first",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                true,
            ),
            tool_with_executor(
                "second",
                serde_json::json!({"type": "object"}),
                Arc::clone(&executed),
                false,
            ),
        ],
        permissions,
        None,
    );

    let error = agent_loop
        .turn(
            terminal_input_with_steps(1),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .expect_err("executor error should propagate");
    assert!(error.to_string().contains("executor failed for first"));
    assert_eq!(
        executed.lock().expect("executed lock").as_slice(),
        ["first"]
    );
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::OutcomeUnknown
    )));
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Cancelled {
            reason: crate::tools::ToolCancellationReason::Parent
        }
    )));
}

// 场景：第一个 LLM attempt 返回 Recoverable，第二个 attempt 返回 terminal response。
// 预期：同一 Step 内重试并成功；不变量：只消费两个 attempt，不产生额外 SessionItem。
#[tokio::test]
async fn recoverable_llm_failure_retries_within_same_step() {
    let dir = tempdir().expect("tempdir");
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        vec![Err(LlmError::RequestFailed {
            kind: crate::llm::protocol::RequestFailureKind::Recoverable,
            message: "temporary".into(),
        })],
        terminal_script("retried"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider {
        scripts: Arc::clone(&scripts),
    });
    let (mut agent_loop, session_id) =
        build_loop(&dir, provider, Vec::new(), ToolPermissionMap::new(), None);

    agent_loop
        .turn(terminal_input(), tokio_util::sync::CancellationToken::new())
        .await
        .expect("recoverable failure should retry");
    assert!(scripts.lock().expect("scripts lock").is_empty());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert_eq!(stored.items().len(), 2);
}

// 场景：LLM attempt 返回 Unrecoverable，队列中仍有后续 script。
// 预期：不重试并传播错误；不变量：不可恢复错误不消耗后续 attempt。
#[tokio::test]
async fn unrecoverable_llm_failure_does_not_retry() {
    let dir = tempdir().expect("tempdir");
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        vec![Err(LlmError::RequestFailed {
            kind: crate::llm::protocol::RequestFailureKind::Unrecoverable,
            message: "permanent".into(),
        })],
        terminal_script("must not run"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider {
        scripts: Arc::clone(&scripts),
    });
    let (mut agent_loop, _session_id) =
        build_loop(&dir, provider, Vec::new(), ToolPermissionMap::new(), None);

    assert!(agent_loop
        .turn(terminal_input(), tokio_util::sync::CancellationToken::new(),)
        .await
        .is_err());
    assert_eq!(scripts.lock().expect("scripts lock").len(), 1);
}

// 场景：LLM stream 持续等待，调用方在 attempt 内取消 token。
// 预期：turn 返回取消错误且 UserMessage 保留；不变量：未完成的 assistant response 不写入 Session。
#[tokio::test]
async fn cancellation_interrupts_llm_attempt() {
    let dir = tempdir().expect("tempdir");
    let provider: Arc<dyn LLMProvider> = Arc::new(PendingProvider);
    let (mut agent_loop, session_id) =
        build_loop(&dir, provider, Vec::new(), ToolPermissionMap::new(), None);
    let token = tokio_util::sync::CancellationToken::new();
    let turn = agent_loop.turn(terminal_input(), token.clone());
    tokio::pin!(turn);
    tokio::select! {
        result = &mut turn => panic!("pending LLM unexpectedly completed: {result:?}"),
        _ = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            token.cancel();
        } => {}
    }
    assert!(turn.await.is_err());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert_eq!(stored.items().len(), 1);
}

// 场景：Recoverable attempt 进入固定 backoff，调用方在 backoff 内取消 token。
// 预期：不消费后续 attempt 且返回取消错误；不变量：backoff 是 cancellation-aware。
#[tokio::test]
async fn cancellation_interrupts_retry_backoff() {
    let dir = tempdir().expect("tempdir");
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![
        vec![Err(LlmError::RequestFailed {
            kind: crate::llm::protocol::RequestFailureKind::Recoverable,
            message: "temporary".into(),
        })],
        terminal_script("must not run"),
    ])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider {
        scripts: Arc::clone(&scripts),
    });
    let (mut agent_loop, _session_id) =
        build_loop(&dir, provider, Vec::new(), ToolPermissionMap::new(), None);
    let token = tokio_util::sync::CancellationToken::new();
    let turn = agent_loop.turn(terminal_input(), token.clone());
    tokio::pin!(turn);
    tokio::select! {
        result = &mut turn => panic!("retry unexpectedly completed: {result:?}"),
        _ = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            token.cancel();
        } => {}
    }
    assert!(turn.await.is_err());
    assert_eq!(scripts.lock().expect("scripts lock").len(), 1);
}

// 场景：ToolCallRecorded 的 post-commit Hook 触发 token 取消，executor 尚未开始。
// 预期：当前 call 为 Cancelled(User)，未开始 sibling 为 Parent；不变量：执行前取消不报告未知副作用。
#[tokio::test]
async fn cancellation_before_tool_execution_uses_user_status() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[(
        "only",
        serde_json::json!({}),
    )])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let token = tokio_util::sync::CancellationToken::new();
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("only".into(), ToolPermission::Allow);
    let (mut agent_loop, session_id) = build_loop_with_hooks(
        &dir,
        provider,
        vec![tool_with_executor(
            "only",
            serde_json::json!({"type": "object"}),
            Arc::clone(&executed),
            false,
        )],
        permissions,
        None,
        vec![Arc::new(CancelOnEventHook {
            token: token.clone(),
            cancel_on_tool_call: true,
            cancel_on_assistant: false,
        })],
    );

    assert!(agent_loop.turn(terminal_input(), token).await.is_err());
    assert!(executed.lock().expect("executed lock").is_empty());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Cancelled {
            reason: crate::tools::ToolCancellationReason::User
        }
    )));
}

// 场景：Ask approval future 持续等待，调用方在 approval 等待期间取消 token。
// 预期：当前 call 为 Cancelled(User)，Turn 返回取消错误；不变量：approval 未完成前不启动 executor。
#[tokio::test]
async fn cancellation_interrupts_approval_wait() {
    let dir = tempdir().expect("tempdir");
    let executed = Arc::new(Mutex::new(Vec::new()));
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[(
        "ask",
        serde_json::json!({}),
    )])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let token = tokio_util::sync::CancellationToken::new();
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("ask".into(), ToolPermission::Ask);
    let (mut agent_loop, session_id) = build_loop(
        &dir,
        provider,
        vec![tool_with_executor(
            "ask",
            serde_json::json!({"type": "object"}),
            Arc::clone(&executed),
            false,
        )],
        permissions,
        Some(Arc::new(PendingApproval)),
    );
    let turn = agent_loop.turn(terminal_input(), token.clone());
    tokio::pin!(turn);
    tokio::select! {
        result = &mut turn => panic!("pending approval unexpectedly completed: {result:?}"),
        _ = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            token.cancel();
        } => {}
    }
    assert!(turn.await.is_err());
    assert!(executed.lock().expect("executed lock").is_empty());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::Cancelled {
            reason: crate::tools::ToolCancellationReason::User
        }
    )));
}

// 场景：executor future 已开始等待，调用方在执行中取消 token。
// 预期：当前 call 为 OutcomeUnknown；不变量：开始执行后不能伪造确定失败。
#[tokio::test]
async fn cancellation_during_tool_execution_uses_unknown_status() {
    let dir = tempdir().expect("tempdir");
    let scripts = Arc::new(Mutex::new(VecDeque::from(vec![tool_use_script(&[(
        "pending",
        serde_json::json!({}),
    )])])));
    let provider: Arc<dyn LLMProvider> = Arc::new(QueuedProvider { scripts });
    let token = tokio_util::sync::CancellationToken::new();
    let mut permissions = ToolPermissionMap::new();
    permissions.insert("pending".into(), ToolPermission::Allow);
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let spec = ToolSpec::new("pending", "pending", serde_json::json!({"type": "object"}))
        .expect("tool spec");
    let runtime = ToolRuntime::new(
        ToolRegistry::new(vec![Tool::new(spec, Arc::new(PendingExecutor))]).expect("tool registry"),
        permissions,
        None,
    )
    .expect("tool runtime");
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", &session_id),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });
    let turn = agent_loop.turn(terminal_input(), token.clone());
    tokio::pin!(turn);
    tokio::select! {
        result = &mut turn => panic!("pending tool unexpectedly completed: {result:?}"),
        _ = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            token.cancel();
        } => {}
    }
    assert!(turn.await.is_err());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert!(stored.items().iter().any(|item| matches!(
        item,
        crate::session::SessionItem::ToolResult {
            result,
            ..
        } if result.status() == &ToolResultStatus::OutcomeUnknown
    )));
}

// 场景：post-commit AssistantFinalized Hook 在最终事实提交后取消 token。
// 预期：terminal response 仍成功返回；不变量：final assistant commit 赢过晚到的 cancellation。
#[tokio::test]
async fn final_assistant_commit_wins_late_cancellation() {
    let dir = tempdir().expect("tempdir");
    let token = tokio_util::sync::CancellationToken::new();
    let provider: Arc<dyn LLMProvider> = Arc::new(MockProvider {
        events: terminal_script("final"),
    });
    let (mut agent_loop, session_id) = build_loop_with_hooks(
        &dir,
        provider,
        Vec::new(),
        ToolPermissionMap::new(),
        None,
        vec![Arc::new(CancelOnEventHook {
            token: token.clone(),
            cancel_on_tool_call: false,
            cancel_on_assistant: true,
        })],
    );

    agent_loop
        .turn(terminal_input(), token.clone())
        .await
        .expect("late cancellation must not override final commit");
    assert!(token.is_cancelled());
    let stored = SessionStore::load(&dir, &session_id).expect("load session");
    assert_eq!(stored.items().len(), 2);
}

// 场景：干净 Session 执行一个 EndTurn；provider 只返回文本和 Finished。
// 预期：UserMessage 与 AssistantMessage 按 Turn 0 提交，返回原 ModelResponse；不变量：Terminal Turn 不产生 ToolCall，AgentLoop 可复用。
#[tokio::test]
async fn terminal_turn_commits_facts_and_returns_response() {
    let dir = tempdir().expect("tempdir");
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let provider = Arc::new(MockProvider {
        events: vec![
            Ok(ModelStreamEvent::TextPart {
                block_index: 0,
                text: "hello".into(),
            }),
            Ok(ModelStreamEvent::Finished {
                stop_reason: StopReason::EndTurn,
                usage: None,
            }),
        ],
    });
    let registry = ToolRegistry::new(Vec::new()).expect("empty registry");
    let runtime =
        ToolRuntime::new(registry, ToolPermissionMap::new(), None).expect("empty runtime");
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", "session"),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });
    let response = agent_loop
        .turn(terminal_input(), tokio_util::sync::CancellationToken::new())
        .await
        .expect("terminal turn");
    assert_eq!(response.stop_reason, StopReason::EndTurn);
    let stored = SessionStore::load(dir.path(), &session_id).expect("load session");
    assert_eq!(stored.items().len(), 2);
    assert!(matches!(
        stored.items()[0],
        crate::session::SessionItem::UserMessage { .. }
    ));
    assert!(matches!(
        stored.items()[1],
        crate::session::SessionItem::AssistantMessage { .. }
    ));

    agent_loop
        .turn(terminal_input(), tokio_util::sync::CancellationToken::new())
        .await
        .expect("second terminal turn");
    let stored = SessionStore::load(dir.path(), &session_id).expect("reload session");
    assert_eq!(stored.items().len(), 4);
    assert!(stored.items().iter().all(|item| item.base().turn <= 1));
}

// 场景：UserMessage 已 commit 后，provider 在首个 LLM call 返回不可恢复错误。
// 预期：Turn 返回错误但 UserMessage 保留；不变量：append-only Session 不回滚已提交事实。
#[tokio::test]
async fn terminal_turn_error_keeps_committed_user_message() {
    let dir = tempdir().expect("tempdir");
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let provider = Arc::new(MockProvider {
        events: vec![Err(LlmError::RequestFailed {
            kind: crate::llm::protocol::RequestFailureKind::Unrecoverable,
            message: "bad request".into(),
        })],
    });
    let runtime = ToolRuntime::new(
        ToolRegistry::new(Vec::new()).expect("empty registry"),
        ToolPermissionMap::new(),
        None,
    )
    .expect("empty runtime");
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", "session"),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });

    assert!(agent_loop
        .turn(terminal_input(), tokio_util::sync::CancellationToken::new(),)
        .await
        .is_err());
    let stored = SessionStore::load(dir.path(), &session_id).expect("load session");
    assert_eq!(stored.items().len(), 1);
    assert!(matches!(
        stored.items()[0],
        crate::session::SessionItem::UserMessage { .. }
    ));
}

// 场景：Session Item Log 已有未闭合 ToolCall round。
// 预期：新 Turn 在 preflight 被拒绝且不追加 UserMessage；不变量：materialize 是新 Turn 的事实前置校验。
#[tokio::test]
async fn terminal_turn_rejects_dangling_history_before_append() {
    let dir = tempdir().expect("tempdir");
    let mut session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    session
        .commit_item(SessionItemDraft::ToolCall {
            turn: 0,
            call: ToolCall::new("tool-1", "noop", serde_json::json!({})).expect("tool call"),
        })
        .expect("commit dangling call");
    let provider = Arc::new(MockProvider { events: Vec::new() });
    let runtime = ToolRuntime::new(
        ToolRegistry::new(Vec::new()).expect("empty registry"),
        ToolPermissionMap::new(),
        None,
    )
    .expect("empty runtime");
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", "session"),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });

    assert!(agent_loop
        .turn(terminal_input(), tokio_util::sync::CancellationToken::new(),)
        .await
        .is_err());
    let stored = SessionStore::load(dir.path(), &session_id).expect("load session");
    assert_eq!(stored.items().len(), 1);
}

// 场景：Turn 在 UserMessage commit 前已取消。
// 预期：turn 返回取消错误且 Session 无新事实；不变量：取消不消费 turn number。
#[tokio::test]
async fn cancelled_before_user_commit_does_not_append() {
    let dir = tempdir().expect("tempdir");
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let provider = Arc::new(MockProvider { events: Vec::new() });
    let runtime = test_runtime(ToolPermission::Allow);
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", "session"),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });
    let token = tokio_util::sync::CancellationToken::new();
    token.cancel();
    let input = TurnInput {
        text: "hi".into(),
        config: ModelRequestConfig {
            model: "mock".into(),
            max_tokens: 32,
            thinking_level: None,
            session_id: Some("session".into()),
        },
        system_prompt: SystemPrompt::new("system"),
        policy: TurnPolicy::new(1).expect("policy"),
    };

    assert!(agent_loop.turn(input, token).await.is_err());
    let stored = SessionStore::load(dir.path(), &session_id).expect("load session");
    assert!(stored.items().is_empty());
}

// 场景：TurnInput 的 user text 为空。
// 预期：turn 入口立即返回错误且不产生 TurnStarted/UserMessage；不变量：空输入不消费 turn number。
#[tokio::test]
async fn empty_user_text_is_rejected_before_events() {
    let dir = tempdir().expect("tempdir");
    let session =
        SessionStore::create(dir.path(), std::env::current_dir().expect("cwd")).expect("session");
    let session_id = session.header().session_id.clone();
    let provider = Arc::new(MockProvider { events: Vec::new() });
    let runtime = ToolRuntime::new(
        ToolRegistry::new(Vec::new()).expect("empty registry"),
        ToolPermissionMap::new(),
        None,
    )
    .expect("empty runtime");
    let events = EventDispatcher::new(
        PipelineRegistry::builder()
            .build_frozen()
            .expect("pipeline"),
        TraceContext::new("legacy-run", "session"),
    );
    let mut agent_loop = AgentLoop::new(AgentLoopInit {
        session,
        provider,
        tools: runtime,
        events,
    });
    let mut input = terminal_input();
    input.text.clear();

    assert!(agent_loop
        .turn(input, tokio_util::sync::CancellationToken::new())
        .await
        .is_err());
    let stored = SessionStore::load(dir.path(), &session_id).expect("load session");
    assert!(stored.items().is_empty());
}
