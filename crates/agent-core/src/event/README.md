# event

> **对外使用说明** — 集成 `agent-core::event` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)
> **状态：** R1–R3 已实现（dispatch · derive · `FileAgentEventWriter`）；R4（async bus）未开始。
> **关联：** [`../session/README.md`](../session/README.md) · [`docs/spec/agent-events.md`](../../../../docs/spec/agent-events.md)

---

## 这是什么

`event` 是 **run 级语义事件** 的入口：`loop` 通过 `emit` 描述「发生了什么」；模块负责分派到 hook、session 落盘、观测 derive。

```text
loop.emit(RunEvent)
    → dispatch
        hook    （可 block）
        commit  （写 Session Item Log，经 session）
        observe （写 Agent Event Log / UI / sidecar）
```

**一句话：** loop 只说话；**不写 session**、**不 derive 文件**（由注册 handler 完成）。

---

## 设计原理（brief）

```text
  Session Item Log     LLMRequest          Agent Event Log
  （事实）              （编译）             （观测）
       ▲                                      ▲
       │ commit 阶段                           │ observe 阶段
       └──────────── RunEvent::dispatch ──────┘
                         ▲
                      loop emit
```

| 事件类 | 写 Session？ | 示例 |
|--------|-------------|------|
| **Committable** | 是（commit 阶段） | `UserPromptCommitted`、`AssistantFinalized` |
| **Observational** | 否 | `TurnStarted`、`MessageUpdate` |

扩展（permission、trace、sidecar）挂在 **Pipeline 注册表**，不改 `loop` 源码。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`loop`** | `EventDispatcher::emit` | `SessionStore`、`commit_item`、直接写 jsonl |
| **`agent`** | 装配 `PipelineRegistry`、`EventDispatcher::new` | 在 loop 内改 dispatch 逻辑 |
| **`session`** | 作为 `CommitHandler` 被调用 | 直接 `emit` |
| **`cli` / UI** | tail `.moontide/runs/*.jsonl` 或 `bus.subscribe` | `emit` |
| **测试** | `EventDispatcher` + mock handlers | — |

---

## 公开 API（契约）

```rust
impl EventDispatcher {
    pub fn emit(&mut self, event: RunEvent) -> anyhow::Result<()>;
}

// agent 装配（run 开始前冻结）
PipelineRegistry::builder()
    .commit(...)
    .hook(...)
    .observe(...)
    .build_frozen();

EventDispatcher::new(registry, TraceContext::new(run_id, session_id));
```

类型：`RunEvent`、`TraceContext`、`HookHandler`、`CommitHandler`、`ObserveHandler` — 见 [`DESIGN.md`](DESIGN.md) §7。

R2/R3：`derive_agent_event`、`DeriveObserveHandler`、`AgentEventWriter`、`FileAgentEventWriter`（`{runs_dir}/{run_id}.active.jsonl`，单调 `seq`）。

---

## 典型用法

### `loop` 作者

```rust
fn run_turn(dispatcher: &mut EventDispatcher, turn: u64, text: &str) -> Result<()> {
    dispatcher.emit(RunEvent::TurnStarted { turn })?;

    dispatcher.emit(RunEvent::UserPromptCommitted {
        turn,
        text: text.to_string(),
    })?;
    // ↑ 同步：UserMessage 已 commit（未被 hook block 时）

    dispatcher.emit(RunEvent::LlmCallStarted {
        turn, step: 0, llm_call_id: new_id(),
    })?;
    // llm::run_model_call_with_updates → 闭包内 emit MessageUpdate
    dispatcher.emit(RunEvent::AssistantFinalized { turn, blocks })?;

    dispatcher.emit(RunEvent::TurnEnded { turn })?;
    Ok(())
}
```

### `agent` 组合根

```rust
use agent_core::event::{
    DeriveObserveHandler, EventDispatcher, FileAgentEventWriter, PipelineRegistry, TraceContext,
};
use agent_core::session::{SessionCommitHandler, SessionStore};

let store = SessionStore::create(&sessions_dir, cwd)?;
let session_id = store.header().session_id.clone();
let writer = FileAgentEventWriter::new(&runs_dir, &run_id)?;

let registry = PipelineRegistry::builder()
    .commit(Arc::new(SessionCommitHandler::new(store)))
    // .hook(Arc::new(permission_hook)) // 可选
    .observe(Arc::new(DeriveObserveHandler::new(writer)))
    .build_frozen()?;

let mut dispatcher = EventDispatcher::new(registry, TraceContext::new(run_id, session_id));
loop::run(&mut dispatcher, …)?;
```

### `cli`（无需 import dispatch）

```text
tail workdir/.moontide/runs/<runId>.active.jsonl
字段：channel · kind · turn · phase · payload（见 agent-events spec）
```

---

## 我该 emit 什么？

| 场景 | `RunEvent` |
|------|------------|
| 用户输入落盘 | `UserPromptCommitted` |
| 助手最终回复 | `AssistantFinalized` |
| tool 调用 / 结果 | `ToolInvocationRecorded` / `ToolOutcomeRecorded` |
| turn / run 边界 | `TurnStarted` / `TurnEnded` / `RunStarted` / `RunEnded` |
| 流式 UI | `MessageUpdate` |
| 单次 LLM 往返 | `LlmCallStarted` / `LlmCallEnded` |

**不要**在 loop 里 `session.commit_item` — 由 commit handler 在 `dispatch` 内完成。

---

## 错误与 block

| 结果 | 行为 |
|------|------|
| hook `Block` | 不 commit |
| commit 失败 | `emit` 返回 `Err` |
| observe 失败 | 默认 log 后继续（fail-open） |
| bus 发送失败 | 忽略 |

---

## 与相邻模块

| 模块 | 关系 |
|------|------|
| [`session`](../session/README.md) | commit 阶段 → `commit_from_event` |
| `llm` | `MessageUpdate` 携带 `ModelResponseSnapshot` |
| `loop` | 唯一 `emit` 调用方 |

Pipeline 算法、`RunEvent` 全表、derive 映射、实现分期见 [`DESIGN.md`](DESIGN.md)。
