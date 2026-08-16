# event — 技术设计

> **读者：** 实现者、代码审查。对外集成见 [`README.md`](README.md)。
> **状态：** 已定稿（2026-08-15）；R1–R3 与 tools typed payload 接缝已实现，测试通过。
> **关联：** [`DESIGN.md`](../session/DESIGN.md) · [`docs/spec/agent-events.md`](../../../../docs/spec/agent-events.md) · [`UBIQUITOUS_LANGUAGE.md`](../../../../UBIQUITOUS_LANGUAGE.md)

---

## 1. 职责与边界

| 做 | 不做 |
|----|------|
| `RunEvent` 语义协议 | `SessionStore` 实现 |
| `EventDispatcher::emit`（hook → commit → observe） | `prompt::compile` / `context::materialize` |
| `derive` → `AgentEventRecord`，经 recorder port 输出 | loop 时序编排（loop mod） |
| `PipelineRegistry` 类型 | sidecar IPC（agent / 后置） |
| 可选 `EventBus` broadcast | ToolPermissionMap 声明与查表（agent / loop） |

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
  agent_recorder.rs   # Agent Event append semantics and file-backed recorder
  file_writer.rs      # path-based raw file I/O only
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
| `ToolCallRecorded { call }` | `ToolCall { call }` | tool 调用 |
| `ToolResultRecorded { result }` | `ToolResult { result }` | tool 结果 |
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
    emit ToolCallRecorded             → commit
  emit ToolResultRecorded             → commit
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
    ToolCallRecorded { turn: u64, call: ToolCall },
    ToolResultRecorded { turn: u64, result: ToolResult },

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

映射 [`agent-events.md`](../../../../docs/spec/agent-events.md)。`derive_agent_event` 只构造 `AgentEventRecord`，`DeriveObserveHandler` 通过 `AgentEventRecorder::append` 转交，不执行文件格式处理。当前文件适配器 `FileAgentEventRecorder` 负责校验 `runId`、恢复下一个 `seq` 与最后 `turn`，并在追加前执行 64 KiB JSONL 截断与最终行长校验，之后调用内部 `FileWriter` 完成文件读写；ID 长度由上游生成契约负责，recorder 不改写 identity 字段。

```rust
pub trait AgentEventRecorder: Send + Sync {
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}
```

tool 接缝直接持有 `crate::tools::ToolCall` / `ToolResult`。event 只负责传递、分派和 derive，不复制调用字段，也不根据 content 文本推断状态。executor 返回基础设施错误时，loop 先 dispatch `OutcomeUnknown` result 并等待 commit 成功，再向 run 边界传播原始错误；event 不自行合成 result。

文件创建、原始行读取和追加写入属于 `FileWriter`；记录解析、恢复、序号分配和 JSONL 编码属于 `FileAgentEventRecorder`。两者都不属于 `RunEvent` 语义派生。当前实现仍与 `agent-core` 同 crate，待组合根建立后迁移具体文件适配器。

---

## 8. import 边界

```text
event     → llm::protocol
event     → tools（只读 ToolCall / ToolResult 契约）
event     ↛ session（CommitHandler 由 agent 注入，可调用 session::commit_from_event）
event derive → AgentEventRecorder::append
FileAgentEventRecorder → FileWriter → filesystem（当前临时适配器，未来归 agent 组合根）

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
5. 当前 `RunEvent` 是内核内部协议；增加必需上下文字段时，必须同步更新 dispatch、derive、commit 和结构测试。持久化 Agent Event / Session Item schema 的变更另行版本化。
6. derive 不依赖文件格式策略；文件大小限制、截断和恢复只由 `FileAgentEventRecorder` 实现。
7. `FileWriter` 不依赖任何 Agent Event 类型，只提供路径级文本行读写。
8. tool RunEvent 直接包装 `ToolCall` / `ToolResult`，不得重新声明 tool_use_id/name/input/status/content 字段组。

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
| 7 | tool 事件直接携带 canonical `ToolCall` / `ToolResult`，不建立 invocation/outcome 副本 |

---

## 12. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | RunEvent + TraceContext + EventDispatcher + 内存 observer 单测 |
| **R2** | derive + channel 映射 |
| **R3** | session commit_from_event + agent-core observer 落盘接线；生产 agent 装配待 agent crate 建立 |
| **R3-F1** | `AgentEventRecorder` port；文件 recorder 集中处理 JSONL 截断、seq/turn 恢复与追加；未来迁移具体适配器 |
| **R3-F2** | `ToolCallRecorded` / `ToolResultRecorded` 直接复用 tools 契约，并在 Agent Event payload 保留 typed status |
| **R4** | bus + sidecar bridge |

---

## 13. 单测方向

- Committable：mock CommitHandler 被调用；Observational 不调用
- hook Block 跳过 commit
- observe 顺序与 fail-open
- derive channel/kind 映射表
- derive handler 原样转交 record，不执行文件截断
- file recorder 的 64 KiB 行限制、identity 校验与 seq/turn 恢复
- tool call/result 的 identity、input、status 与 content derive 不丢失
- emit 顺序守门（与 loop 契约文档一致）
