# event

> **对外使用说明** — 集成 `agent-core::event` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)。
> **状态：** R1–R3、typed payload 与 Loop R1 post-commit Hook / borrowed commit 接缝已实现；Agent Event Log worker 由 `agent::log` 后置接入；R4 observer bridge 后置。
> **关联：** [`../loop/README.md`](../loop/README.md) · [`../session/README.md`](../session/README.md) · [`crates/docs/agent-core.md`](../../../docs/agent-core.md)

---

## 这是什么

`event` 是 **Turn 级语义事件** 的分派入口：`loop` 通过 `emit` 描述「发生了什么」；event 同步提交恢复事实，再把不可变事件交给扩展 Hook。

```text
loop.emit(TurnEvent, &mut SessionStore)
    → dispatch
        commit  （仅 Committable；写 Session Item Log）
        hook*   （post-commit、fail-open；Agent Event / UI / sidecar / metrics）
        observer bridge     （后置观测加速）
```

**一句话：** loop 只 emit，不直接 `commit_item`；Hook 只观察已经发生的事实，不参与 permission、取消、retry 或 Turn 决策。

---

## 设计原理（brief）

```text
  Session Item Log     ModelRequest          Agent Event Log
  （事实）              （编译）             （观测）
       ▲                                      ▲
       │ mutable commit borrow                 │ Hook derive
       └──────────── TurnEvent::dispatch ──────┘
                         ▲
                      loop emit
```

| 事件类 | 写 Session？ | Hook 时机 | 示例 |
|--------|-------------|-----------|------|
| **Committable** | 是 | commit 成功后 | `UserPromptCommitted`、`AssistantFinalized` |
| **Observational** | 否 | 直接调用 | `TurnStarted`、`MessageUpdate` |

`PipelineRegistry` 只冻结 Hook 注册表。CommitHandler 不放进 registry，也不由 EventDispatcher 长期拥有；AgentLoop 每次 emit 时借入它独占持有的 SessionStore。

`AssistantFinalized` 的非空 blocks 变体写入 Session；tool-only response 可以发送一次空 blocks finalized marker 关闭运行时 draft，但该 marker 不写入 Session Item Log。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`loop`** | `EventDispatcher::emit(&mut commit, event)` | `commit_item`、直接写 Agent Event JSONL |
| **`agent`** | 装配 `PipelineRegistry`、Agent Event Hook、`EventDispatcher` | 把 permission 或 control flow 放进 Hook |
| **`session`** | 直接实现 mutable `CommitHandler` | `emit`、持有 dispatcher |
| **`cli` / UI** | 通过 Progress 或 tail `.moontide/runs/*.active.jsonl` | `emit` |
| **Hook 作者** | 只读 `TraceContext` / `TurnEvent`，输出观测副作用 | Block、Approve、Cancel、Retry、修改 event |
| **测试** | dispatcher + mock commit/hooks | 依赖 hook 返回值决定正确性 |

---

## 公开 API（Loop R1 目标契约）

```rust
pub trait CommitHandler {
    fn commit(&mut self, event: &TurnEvent) -> anyhow::Result<Option<String>>;
}

pub trait HookHandler: Send + Sync {
    fn on_event(
        &self,
        ctx: &TraceContext,
        event: &TurnEvent,
    ) -> anyhow::Result<()>;
}

impl EventDispatcher {
    pub fn emit(
        &mut self,
        commit: &mut dyn CommitHandler,
        event: TurnEvent,
    ) -> anyhow::Result<()>;
}

PipelineRegistry::builder()
    .hook(...)
    .hook(...)
    .build_frozen();

EventDispatcher::new(registry, TraceContext::new(run_id, session_id));
```

当前实现是 `commit → post-commit Hook`；`EventDispatcher` 每次 emit 借用 mutable commit target，`PipelineRegistry` 只冻结 Hook。旧的 `HookOutcome::Block` 与独立 `ObserveHandler` 已删除；AgentEvent、schema 和 derive mapping 保持稳定，queue、worker 与 file writer 按 R2 设计迁移到 `agent::log`。

Agent Event 能力由 `DeriveAgentEventHook` 接线。event core 只负责 derive
`AgentEventRecord` 和提供 `AgentEventRecorder` port；Hook 不能直接执行文件 IO。
队列、worker 和文件 recorder 由组合根的 [`agent::log`](../../../agent/src/log/README.md)
负责：

```rust
pub trait AgentEventRecorder: Send + Sync {
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}
```

Hook 只调用 `derive_agent_event` 并转交 recorder。`agent::log::AgentEventLogWorker`
负责文件句柄、`seq` / 最后 `turn` 恢复、64 KiB JSONL 行限制、批量 flush、rotation
和 retention。worker 使用 bounded queue；队列满时不阻塞 loop，累计
`dropped_events` 并暴露 `Degraded` 状态。完整 canonical payload 在 queue 中保留，
落盘时才允许 truncate / preview / 简化。

Agent Event Log 是诊断观测，不是 Session Item Log 的替代品。`SessionOnly`
模式下可以完全关闭 Agent Event Log；resume 只读取 Session Item Log。

`runId` / `run_id` / `runs/` 是现有 Agent Event wire/storage 的 legacy 分区契约，不定义可 cancel、resume、await 的 Run 实体。等 observability 正式接入后，再设计 trace/span identity 与迁移。

---

## 典型用法

### loop 作者

```rust
fn emit_turn_start(
    dispatcher: &mut EventDispatcher,
    session: &mut SessionStore,
    turn: u64,
    text: String,
) -> anyhow::Result<()> {
    dispatcher.emit(session, TurnEvent::TurnStarted { turn })?;
    dispatcher.emit(
        session,
        TurnEvent::UserPromptCommitted { turn, text },
    )?;
    Ok(())
}
```

对 `UserPromptCommitted`，`emit` 返回 `Ok` 表示 UserMessage 已 commit；Hook 的失败不改变这一事实。

### agent 组合根

```rust
let session = SessionStore::create(&sessions_dir, cwd)?;
let session_id = session.header().session_id.clone();
let recorder = agent::log::QueuedAgentEventRecorder::new(agent_event_queue);

let registry = PipelineRegistry::builder()
    .hook(Arc::new(DeriveAgentEventHook::new(recorder)))
    .hook(Arc::new(ui_hook))
    .build_frozen()?;

let events = EventDispatcher::new(
    registry,
    TraceContext::new(run_id, session_id),
);

let agent_loop = AgentLoop::new(AgentLoopInit {
    session,
    provider,
    tools,
    events,
});
```

`AgentEventLogWorker::start(...)` 在同一个 Tokio runtime 内启动，并独占
`FileAgentEventRecorder` / 文件句柄；Hook registry 只持有 queue producer。
`Agent::create` / `resume` / `reload` 在无 Tokio runtime 时返回错误。

### cli（无需 import dispatch）

```text
tail workdir/.moontide/runs/<runId>.active.jsonl
字段：channel · kind · turn · phase · payload
```

---

## 我该 emit 什么？

| 场景 | `TurnEvent` |
|------|-------------|
| 用户输入落盘 | `UserPromptCommitted` |
| 助手最终 blocks | `AssistantFinalized` |
| tool 调用 / 结果 | `ToolCallRecorded { call }` / `ToolResultRecorded { result }` |
| turn 边界 | `TurnStarted` / `TurnEnded` |
| 流式 UI | `MessageUpdate` |
| LLM attempt 开始 / 终止 outcome | `LlmCallStarted` / `LlmCallEnded` |

tool 事件直接携带 `tools::ToolCall` / `tools::ToolResult`。event 不复制字段，也不解释 permission、retry、cancellation 或 scheduler 策略。executor 基础设施错误时，loop 先 emit `OutcomeUnknown` result，剩余 sibling calls 由 loop 配对；event 不自行合成结果。

---

## 错误语义

| 结果 | 行为 |
|------|------|
| commit 失败 | `emit` 返回 `Err`；不运行该事件的 Hook |
| 某 Hook 失败 | 记录诊断，继续后续 Hook，`emit` 仍按 commit 结果返回 |
| observer bridge 发送失败 | 忽略；observer bridge 不参与正确性 |

Hook 是架构扩展 callback，不是决策 handler。需要决定 permission、approval、cancel、retry、config 或调度时，使用对应的显式 API，不增加 Hook 返回枚举。

---

## 与相邻模块

| 模块 | 关系 |
|------|------|
| [`session`](../session/README.md) | SessionStore 作为每次 emit 借入的 CommitHandler |
| [`loop`](../loop/README.md) | 唯一生产 emit 调用方，拥有 commit target |
| `llm` | `MessageUpdate` 携带 `ModelResponseSnapshot` |
| `agent` | 构造 Hook registry 与具体 recorder |

Pipeline 算法、`TurnEvent` 全表、迁移分期与不变量见 [`DESIGN.md`](DESIGN.md)。
