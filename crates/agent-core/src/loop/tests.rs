use std::{future::Future, pin::Pin, sync::Arc};

use futures::stream;
use tempfile::tempdir;

use crate::{
    event::{EventDispatcher, PipelineRegistry, TraceContext},
    llm::{
        protocol::{ContentBlock, LlmError, ModelResponse, ModelStreamEvent, StopReason},
        LLMProvider,
    },
    model_input::{ModelRequestConfig, SystemPrompt},
    session::{SessionItemDraft, SessionStore},
    tools::{Tool, ToolCall, ToolExecutor, ToolRegistry, ToolResult},
};

use super::response::terminal_assistant_blocks;
use super::{
    AgentLoop, AgentLoopInit, ToolPermission, ToolPermissionMap, ToolRuntime, TurnInput, TurnPolicy,
};

struct MockProvider {
    events: Vec<Result<ModelStreamEvent, crate::llm::protocol::LlmError>>,
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
