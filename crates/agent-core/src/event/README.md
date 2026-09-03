# event

**Turn 级语义事件**分派：`TurnEvent` 协议、同步 commit → post-commit Hook（fail-open）→ 可选 observer bridge；维护事实提交与扩展观测的顺序，Hook 不参与 permission、cancel 或 retry 决策。

**设计：** [`DESIGN.md`](../../DESIGN.md#event)

## 公开入口

- `TurnEvent`、`LlmCallOutcome`、`LlmCallFailureKind` — loop emit 的运行语义
- `TraceContext` — `run_id`、`session_id`、turn/step 与 event-local correlation 字段
- `CommitHandler` — mutable commit seam（`SessionStore` 实现）
- `HookHandler`、`PipelineRegistry`、`PipelineRegistryBuilder` — 冻结 Hook 注册表
- `EventDispatcher::emit(&mut dyn CommitHandler, TurnEvent)` — 唯一 dispatch 入口
- `ObserverBridge`、`ObserverEvent` — 后置 bounded 观测队列
- `derive_agent_event`、`AgentEventRecord`、`AgentEventRecorder`、`DeriveAgentEventHook` — Agent Event derive 与 recorder port

Committable 事件先 commit 再 Hook；Observational 事件不写 Session。Agent Event Log 是 derive 观测，不是 Session Item Log 替代品；文件 IO 与 worker 在 `agent::log`。

## 调用边界

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| `loop` | `EventDispatcher::emit` | 直接 `commit_item`、写 Agent Event 文件 |
| `agent` | 装配 registry、Hook、recorder、observer bridge | 把 control flow 放进 Hook |
| `session` | 实现 `CommitHandler` | `emit`、持有 dispatcher |
| Hook 作者 | 只读 `TraceContext` / `TurnEvent` | Block、Approve、Cancel、Retry |

## 相邻模块

[`loop`](../loop/README.md) · [`session`](../session/README.md) · [`llm`](../llm/README.md) · [`tools`](../tools/README.md)
