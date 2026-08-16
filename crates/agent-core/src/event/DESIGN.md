# event — 技术设计

> **读者：** 实现者、代码审查。对外集成见 [`README.md`](README.md)。
> **状态：** 已定稿（2026-08-15）；R1–R3 已实现，测试通过。
> **关联：** [`DESIGN.md`](../session/DESIGN.md) · [`docs/spec/agent-events.md`](../../../../docs/spec/agent-events.md) · [`UBIQUITOUS_LANGUAGE.md`](../../../../UBIQUITOUS_LANGUAGE.md)

---

## 1. 职责与边界

| 做 | 不做 |
|----|------|
| `RunEvent` 语义协议 | `SessionStore` 实现 |
| `EventDispatcher::emit`（hook → commit → observe） | `prompt::compile` / `context::materialize` |
| `derive` → Agent Event Log | loop 时序编排（loop mod） |
| `PipelineRegistry` 类型 | sidecar IPC（agent / 后置） |
| 可选 `EventBus` broadcast | permission 策略本身（permission mod） |

**核心：** `loop` 只 `emit`；事实落盘在 commit 阶段委托 `session`；观测在 observe 阶段 `derive`。

---

## 2. 三条线

```text
  Session Item Log          LLMRequest              Agent Event Log
  （session）               （context）              （event derive）
        ▲                         │                        ▲
        │ commit                   │ compile                │ observe
        └──────── dispatch ────────────────────────────────┘
                              ▲ emit
                           loop
```

---

## 3. 模块结构（计划）

```text
event/
  README.md
  DESIGN.md           # 本文
  mod.rs
  run_event.rs
  trace_context.rs
  pipeline.rs         # dispatch
  registry.rs         # PipelineRegistry
  derive.rs
  bus.rs              # R4
  tests.rs
```

---

## 4. `RunEvent` 分类

### 4.1 Committable vs Observational

| 类 | Pipeline |
|----|----------|
| **Committable** | hook → **commit** → observe |
| **Observational** | hook? → observe only |

### 4.2 Committable

| `RunEvent` | → `SessionItem` | 时机 |
|------------|-----------------|------|
| `UserPromptCommitted` | `UserMessage` | LLM 前 |
| `AssistantFinalized` | `AssistantMessage` | 流式结束 |
| `ToolInvocationRecorded` | `ToolInvocation` | tool 调用 |
| `ToolOutcomeRecorded` | `ToolOutcome` | tool 结果 |
| `CompactionApplied` | `Compaction` | R2+ |

### 4.3 Observational

| `RunEvent` | Agent Event `channel` |
|------------|----------------------|
| `RunStarted` / `RunEnded` | `trace` |
| `TurnStarted` / `TurnEnded` | `trace` |
| `LlmCallStarted` / `LlmCallEnded` | `trace` |
| `MessageUpdate` | `trace` |
| `ContextPreflightEnded` / `ContextPostflightEnded` | `context` |
| `CompactionRecommended` | `context` |

---

## 5. `dispatch` 算法

```text
emit(event):
  if is_committable(event):
    for hook in registry.hooks:
      match hook.on_event(ctx, &event)?:
        Block { reason } => return Ok(())  // 或 emit Blocked observe（R2 定）
    item_id = registry.commit.commit(&event)?
    ctx.session_item_id = item_id
  for observer in registry.observers:
    let _ = observer.observe(ctx, &event)  // fail-open
  bus.publish(event)  // 可选；失败忽略
```

**同步 commit 路径** 决定正确性；bus 仅观测加速。

---

## 6. Turn 时序（loop 契约）

```text
with_turn:
  emit TurnStarted
  emit UserPromptCommitted          → commit UserMessage
  [context::materialize → prompt::compile]
  with_step:                         # 可多次
    emit LlmCallStarted
    llm::run_model_call* → MessageUpdate*
    emit LlmCallEnded
    emit AssistantFinalized           → commit AssistantMessage
    emit ToolInvocationRecorded     → commit
  emit ToolOutcomeRecorded          → commit
  emit TurnEnded
  [context::postflight]
```

硬顺序：

1. `UserPromptCommitted` commit 先于 `LlmCallStarted`
2. `AssistantFinalized` commit 先于 tool 执行
3. 重 postnorm 绑 `TurnEnded`

---

## 7. 类型签名

### 7.1 `RunEvent`（节选）

```rust
pub enum RunEvent {
    RunStarted { run_id: String, session_id: String },
    RunEnded { run_id: String },
    TurnStarted { turn: u64 },
    TurnEnded { turn: u64 },

    UserPromptCommitted { turn: u64, text: String },
    AssistantFinalized { turn: u64, blocks: Vec<ContentBlock> },
    ToolInvocationRecorded { turn: u64, tool_use_id: String, name: String, input: Value },
    ToolOutcomeRecorded { turn: u64, tool_use_id: String, name: String, content: ToolResultContent },

    LlmCallStarted { turn: u64, step: u32, llm_call_id: String },
    LlmCallEnded { turn: u64, step: u32, llm_call_id: String, stop_reason: StopReason, usage: Option<Usage> },
    MessageUpdate { turn: u64, step: u32, llm_call_id: String, snapshot: ModelResponseSnapshot },

    // R2+
    CompactionApplied { /* … */ },
    CompactionRecommended { /* … */ },
    ContextPreflightEnded { /* … */ },
    ContextPostflightEnded { /* … */ },
}
```

### 7.2 `TraceContext`

```rust
pub struct TraceContext {
    pub run_id: String,
    pub session_id: String,
    pub turn: u64,
    pub step: u32,
    pub llm_call_id: Option<String>,
    pub tool_use_id: Option<String>,
    pub session_item_id: Option<String>,
}
```

### 7.3 Handler traits

```rust
pub enum HookOutcome { Continue, Block { reason: String } }

pub trait HookHandler: Send + Sync {
    fn on_event(&self, ctx: &TraceContext, event: &RunEvent) -> anyhow::Result<HookOutcome>;
}
pub trait CommitHandler: Send + Sync {
    fn commit(&self, event: &RunEvent) -> anyhow::Result<Option<String>>;
}
pub trait ObserveHandler: Send + Sync {
    fn observe(&self, ctx: &TraceContext, event: &RunEvent) -> anyhow::Result<()>;
}
```

### 7.4 `PipelineRegistry` / `EventDispatcher`

```rust
pub struct PipelineRegistry { /* hooks, commit, observers；build_frozen */ }
pub struct EventDispatcher { registry: PipelineRegistry, trace: TraceContext }

impl EventDispatcher {
    pub fn emit(&mut self, event: RunEvent) -> anyhow::Result<()>;
}
```

Registry 在 run 开始前由 `agent` 装配，run 内不可换表。

### 7.5 `derive`

```rust
pub fn derive_agent_event(ctx: &TraceContext, event: &RunEvent) -> Option<AgentEventRecord>;
```

映射 [`agent-events.md`](../../../../docs/spec/agent-events.md)；落盘 64KiB 截断。

---

## 8. import 边界

```text
event     → llm::protocol
event     ↛ session（CommitHandler 由 agent 注入，可调用 session::commit_from_event）

loop      → EventDispatcher::emit
agent     → 构建 PipelineRegistry
cli       → bus 或 tail runs/*.jsonl
```

---

## 9. 不变量

1. loop 不 commit session
2. Observational 不进 commit 阶段
3. dispatch 同步有序；不依赖 bus 完成 commit
4. derive 不写回 Session Item Log
5. `RunEvent` 协议只增不改

---

## 10. 错误策略

| 阶段 | 策略 |
|------|------|
| hook `Block` | 跳过 commit（observe 是否记录 Block，R2 定） |
| commit `Err` | 向上传播 |
| observe `Err` | fail-open，log 继续 |
| bus 失败 | 忽略 |

---

## 11. 决策记录

| # | 决策 |
|---|------|
| 1 | Event（观测）与 Hook（决策）分离 |
| 2 | Pipeline 三阶段写死，非全局 plugin chain |
| 3 | bus 在 observe 之后 |
| 4 | 流式 `MessageUpdate`；全文 `AssistantFinalized` commit |
| 5 | `TurnStarted` 不进 Item Log |
| 6 | 扩展注册在 agent crate |

---

## 12. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | RunEvent + TraceContext + EventDispatcher + 内存 observer 单测 |
| **R2** | derive + channel 映射 |
| **R3** | session commit_from_event + agent-core observer 落盘接线；生产 agent 装配待 agent crate 建立 |
| **R4** | bus + sidecar bridge |

---

## 13. 单测方向

- Committable：mock CommitHandler 被调用；Observational 不调用
- hook Block 跳过 commit
- observe 顺序与 fail-open
- derive channel/kind 映射表
- emit 顺序守门（与 loop 契约文档一致）
