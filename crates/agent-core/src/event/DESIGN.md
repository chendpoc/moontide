# event — 技术设计

> **读者：** 实现者、代码审查。对外集成见 [`README.md`](README.md)。
> **状态：** R1–R3、typed payload 与 Loop R1 post-commit Hook / borrowed mutable commit 重构已实现；R2 只保留 Agent Event derive/recorder port，Agent Event Log worker 属于 `agent::log` 的 R3 optional；R4 observer bridge 后置。
> **关联：** [`../loop/DESIGN.md`](../loop/DESIGN.md) · [`../session/DESIGN.md`](../session/DESIGN.md) · [`crates/docs/agent-core.md`](../../../docs/agent-core.md) · [`UBIQUITOUS_LANGUAGE.md`](../../../../UBIQUITOUS_LANGUAGE.md)

---

## 1. 职责与边界

| 做 | 不做 |
|----|------|
| `TurnEvent` 语义协议 | Turn/Step/tool 状态机（loop） |
| 同步 dispatch：commit → post-commit Hook | permission、approval、retry、cancel 决策 |
| `derive` → AgentEventRecord / recorder port | `SessionStore` 实现 |
| Hook registry 与 TurnEvent dispatch | sidecar IPC |
| event schema 与 derive mapping | Agent Event queue、worker、文件 IO |

**核心：** event 维护事实提交与扩展 callback 的顺序；它不拥有事实源，也不允许 Hook 改变正确性路径。

```text
Committable TurnEvent:
  mutable commit borrow → Hook* fail-open → observer bridge

Observational TurnEvent:
  Hook* fail-open → observer bridge
```

Agent Event Log 是 Hook 的一个消费者，不是 Session Item Log 的替代品。

---

## 2. 三条线

```text
  Session Item Log          ModelRequest            Agent Event Log
  （session）               （model_input）          （event derive）
        ▲                         │                        ▲
        │ commit                   │ compile                │ Hook
        └──────── dispatch ────────────────────────────────┘
                              ▲ emit
                           loop
```

---

## 3. 模块结构（目标）

```text
event/
  README.md
  DESIGN.md
  TASKS.md
  mod.rs
  turn_event.rs
  trace_context.rs
  pipeline.rs             # dispatch
  registry.rs             # frozen Hook registry
  derive.rs
  agent_recorder.rs       # AgentEventRecorder port / derive hook
  observer_bridge.rs      # 后置 observer bridge
  tests.rs
```

当前 AgentEventRecord、wire schema 与 derive mapping 保留。R2 不强制装配 Agent Event
queue、worker 和 FileAgentEventRecorder；未来实现时迁移到 `agent::log`，event core 不拥有
Tokio worker 或物理文件 IO。

---

## 4. `TurnEvent`

### 4.1 Committable

| `TurnEvent` | → `SessionItem` | 时机 |
|-------------|-----------------|------|
| `UserPromptCommitted` | `UserMessage` | LLM 前 |
| `AssistantFinalized` with non-empty blocks | `AssistantMessage` | 完整 assistant blocks 确认后 |
| `AssistantFinalized` with empty blocks | no Session item | tool-only successful call 的 finalized marker |
| `ToolCallRecorded { call }` | `ToolCall { call }` | tool 副作用前 |
| `ToolResultRecorded { result }` | `ToolResult { result }` | 单 call 结果确定后 |
| `CompactionApplied` | `Compaction` | 后置 context policy |

### 4.2 Observational

| `TurnEvent` | Agent Event channel |
|-------------|---------------------|
| `TurnStarted` / `TurnEnded` | `trace` |
| `LlmCallStarted` / `LlmCallEnded` | `trace` |
| `MessageUpdate` | `trace` |
| `ContextPreflightEnded` / `ContextPostflightEnded` | `context` |
| `CompactionRecommended` | `context` |

Observational event 不借 commit handler 写入事实源。为了保持一个统一入口，`emit` 仍接受 mutable commit borrow，但对这类事件不调用它。

---

## 5. Target dispatch 算法

```text
emit(commit, event):
  clear TraceContext transient fields:
    session_item_id = None
    tool_use_id = None
    llm_call_id = None
  update TraceContext correlation fields from event

  if event.is_committable():
    session_item_id = commit.commit(&event)?
    trace.session_item_id = session_item_id

  for hook in registry.hooks:
    if hook.on_event(&trace, &event) returns Err:
      diagnose error
      continue

  observer_bridge.publish(event)  # optional; failure ignored
  return Ok
```

同步 commit 是正确性路径；Hook 和 observer bridge 都是观测扩展。Committable event 的 Hook 只在 commit 成功后看到事件，因此不能观测到“声称已提交但实际失败”的事实。Transient identity 只属于当前 emit；Hook 不从 TraceContext 读取上一事件的 `session_item_id`、`tool_use_id` 或 `llm_call_id`。

Hook 调用顺序等于 frozen registry 的注册顺序；一个 Hook 失败不能跳过后续 Hook。诊断输出使用 logger/stderr，不递归 emit 新 TurnEvent。

---

## 6. Loop R1 时序接缝

```text
Turn:
  materialize existing Session Item Log
  next_turn
  emit TurnStarted                       # observational
  emit UserPromptCommitted               # commit UserMessage

  Step 0..max_steps:
    materialize → compile
    emit LlmCallStarted
    llm::run_model_call* → MessageUpdate*
    emit exactly one LlmCallEnded for every attempt, with its outcome

    terminal response:
      emit AssistantFinalized            # no tool blocks
      emit TurnEnded

    ToolUse response:
      emit AssistantFinalized once; use empty blocks when the response is tool-only
      emit every ToolCallRecorded         # all calls before side effects
      sequentially process and emit every ToolResultRecorded
      next Step, or close round then fail at max_steps
```

硬顺序：

1. `UserPromptCommitted` 成功先于首个 LLM attempt；
2. 一个成功完成的 LLM call 恰好产生一个 `AssistantFinalized`；非空 blocks 才写入 Session，tool-only 的空 marker 不写入 Session；
3. 同一 round 的全部 ToolCall 先于任何 executor 副作用；
4. 每个 call 恰好一个 ToolResult，下一 Step 前 round 全量闭合；
5. executor Err / 执行中取消的当前 result 是 `OutcomeUnknown`，未开始 siblings 是 `Cancelled(Parent)`。

重试 attempt 复用同一 Step，但使用新的 `llm_call_id`。每个 attempt，无论成功、请求失败、无效响应或取消，都恰好产生一个 `LlmCallEnded`；失败 attempt 的 partial updates 只在 Agent Event 中出现，不 commit AssistantMessage。

---

## 7. 类型签名

### 7.1 `LlmCallOutcome`

```rust
pub enum LlmCallFailureKind {
    Request(RequestFailureKind),
    InvalidResponse,
}

pub enum LlmCallOutcome {
    Succeeded {
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
    Failed {
        kind: LlmCallFailureKind,
    },
    Cancelled {
        reason: CancelReason,
    },
}
```

`LlmCallOutcome` 是运行时语义，不承载 provider 原始错误文本；详细诊断继续由 logger 记录。`StopReason`、`RequestFailureKind` 和 `CancelReason` 保持 enum，不在 progress 或 frontend API 中降级为状态字符串。

### 7.2 `TurnEvent`

```rust
pub enum TurnEvent {
    TurnStarted { turn: u64 },
    TurnEnded { turn: u64 },

    UserPromptCommitted { turn: u64, text: String },
    AssistantFinalized {
        turn: u64,
        llm_call_id: String,
        blocks: Vec<ContentBlock>,
    },
    ToolCallRecorded { turn: u64, call: ToolCall },
    ToolResultRecorded { turn: u64, result: ToolResult },

    LlmCallStarted { turn: u64, step: u32, llm_call_id: String },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        outcome: LlmCallOutcome,
    },
    MessageUpdate {
        turn: u64,
        step: u32,
        llm_call_id: String,
        snapshot: ModelResponseSnapshot,
    },

    CompactionApplied { /* current fields */ },
    CompactionRecommended { turn: u64 },
    ContextPreflightEnded { turn: u64 },
    ContextPostflightEnded { turn: u64 },
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

`TraceContext.run_id` 是 legacy Agent Event 分区字段，不是领域 Run。Turn identity 仍是 `(session_id, turn)`；未来 OTel trace/span 接入另行设计，不在本批把 `TraceContext` 改名为 `EventContext`。

`session_item_id`、`tool_use_id`、`llm_call_id` 是 event-local transient correlation fields。每次 `emit` 开始清理三者，再由当前 TurnEvent 填充；`run_id` 与 `session_id` 是稳定上下文，不清理。

### 7.3 Handler traits

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
```

目标契约删除：

- `HookOutcome`：Hook 不返回 Block；
- `ObserveHandler`：与 post-commit Hook 语义重复；
- registry-owned `CommitHandler`：它会迫使 SessionStore 被长期共享或包进 Mutex。

### 7.4 Registry / dispatcher

```rust
pub struct PipelineRegistry {
    hooks: Vec<std::sync::Arc<dyn HookHandler>>,
}

pub struct EventDispatcher {
    registry: PipelineRegistry,
    trace: TraceContext,
}

impl EventDispatcher {
    pub fn emit(
        &mut self,
        commit: &mut dyn CommitHandler,
        event: TurnEvent,
    ) -> anyhow::Result<()>;
}
```

Registry 由 agent 构造并冻结；EventDispatcher 由 AgentLoop 独占持有。Hook 使用 `Arc` 是因为不同实现可动态装配并作为测试 seam；commit 使用短期 `&mut` 是因为它只有一个正确性 owner。

### 7.5 Agent Event derive Hook

```rust
pub fn derive_agent_event(
    ctx: &TraceContext,
    event: &TurnEvent,
) -> anyhow::Result<Option<AgentEventRecord>>;

pub trait AgentEventRecorder: Send + Sync {
    /// Must be non-blocking for the EventDispatcher caller.
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}

pub struct DeriveAgentEventHook { /* recorder */ }

impl HookHandler for DeriveAgentEventHook {
    fn on_event(
        &self,
        ctx: &TraceContext,
        event: &TurnEvent,
    ) -> anyhow::Result<()>;
}
```

`DeriveAgentEventHook` 只调用 `derive_agent_event` 并转交 `AgentEventRecorder`。具体 queued recorder、worker 和 FileAgentEventRecorder 位于 `agent::log`；`append` 只做 bounded `try_send`，不能同步写文件。

`derive_agent_event` 使用私有借用 DTO 固定 Agent Event wire schema，序列化失败返回 `Err`。ToolCall/ToolResult 直接来自 canonical tools 契约；wire DTO 不形成并行领域模型。

`agent::log::AgentEventLogWorker` 负责校验 `runId`、恢复下一个 `seq` 与最后
`turn`、64 KiB JSONL 截断、批量 flush、rotation 和 retention。queue 只按事件
数量 bounded；队列满时不等待，累计 `dropped_events` 并进入 `Degraded`。
`dropped_bytes`、byte-budget queue 和 metrics exporter 后置。R2 不实现 Agent Event Log
worker；后续 Agent Event Log
worker 与 ProgressWorker 使用不同 queue、writer 和状态。

---

## 8. import 边界

```text
event → llm::protocol
event → tools（只读 ToolCall / ToolResult）
event ↛ loop
agent::log → event::{AgentEventRecord, AgentEventRecorder}

session → event::CommitHandler + TurnEvent（直接实现 mutable seam）
loop → EventDispatcher::emit + TurnEvent
agent → PipelineRegistry + concrete Hook/recorder assembly
cli → observer bridge 或 tail runs/*.active.jsonl
```

`event` 不 import SessionStore。`session` 已经拥有 TurnEvent → SessionItem 的 commit mapping，因此实现 CommitHandler 不新增反向编排依赖。

---

## 9. 不变量

1. loop 不直接 `commit_item`；
2. Observational event 不调用 commit；
3. Committable event 先 commit，成功后 Hook 才能观察；
4. commit error 原样传播，Hook error fail-open；
5. Hook 不能 Block、Approve、Cancel、Retry 或修改 event；
6. Hook 顺序稳定，一个失败不跳过后续 Hook；
7. 每次 emit 清理 transient correlation fields，Hook 只能看到当前 event 的 identity；
8. EventDispatcher / PipelineRegistry 不拥有 SessionStore；
9. derive 不写回 Session Item Log；
10. observer bridge 不参与 commit 完成条件；
11. `TurnEvent` 增加字段时同步 dispatch、derive、commit 与结构测试；
12. Agent Event / Session Item schema 的持久化变化另行版本化；
13. tool event 直接包装 ToolCall / ToolResult，不复制领域字段；
14. file recorder 与 FileWriter 职责保持分离；
15. legacy `runId` 不引入 Run 执行实体。

---

## 10. 错误策略

| 阶段 | 策略 |
|------|------|
| commit `Err` | 停止当前 dispatch，向 loop 传播 |
| Hook `Err` | 记录诊断，继续后续 Hook，最终 `Ok` |
| Agent Event derive/append `Err` | 作为 Hook error fail-open，不回滚 Session |
| observer bridge 失败 | 忽略 |

Hook 的 fail-open 不是吞掉诊断：实现必须至少经 logger/stderr 记录 hook identity 与错误上下文，但不能递归 emit。

---

## 11. 决策记录

1. TurnEvent 是内核运行语义；Agent Event 是 derive 的观测 wire；
2. Session commit 是同步正确性路径，observer bridge 只是后置观测扩展；
3. Hook 的本质是可维护/可扩展 callback，不是决策链；
4. Hook 统一在 commit 后运行并 fail-open；Observational event 直接进入 Hook；
5. 删除 `HookOutcome::Block` 与重复 `ObserveHandler`；
6. CommitHandler 从 registry 移出，EventDispatcher 每次 emit 借用 mutable handler；
7. SessionStore 直接实现 commit seam，不再用 Mutex wrapper 转移所有权；
8. AgentEvent、schema、recorder、storage、file writer 在接缝迁移中必须保留；
9. tool event 直接携带 canonical ToolCall/ToolResult；
10. 删除执行领域 Run；legacy `runId` / `runs/` 暂不迁移；
11. OTel trace/span 与 EventContext 命名等 observability 接入时再设计；
12. TraceContext 的 transient identity 只服务当前 emit，避免跨事件残留关联。

---

## 12. 实现分期

| 批 | 范围 | 状态 |
|----|------|------|
| **R1** | TurnEvent + TraceContext + EventDispatcher + handlers | 已实现旧 pipeline |
| **R2** | derive + channel mapping | 已实现 |
| **R3-legacy** | session commit + Agent Event recorder/file adapter | 旧实现保留，R2 不装配 |
| **R3-F2** | ToolCall/ToolResult typed payload | 已实现 |
| **R4-A** | borrowed mutable CommitHandler；post-commit Hook；Observe adapter 合并；保留 AgentEvent 栈 | 已实现于 Loop R1 |
| **R4-B** | optional observer bridge + sidecar bridge | 后置 |

R4-A 应作为 loop `batch-implement` 的第一批接缝任务。它不授权删除任何已存在的观测能力。

---

## 13. 单测方向

- Committable 先调用 mutable commit，再调用 Hook；Observational 不调用 commit；
- commit Err 时 Hook 不运行且原错误传播；
- Hook Err 被诊断、后续 Hook 仍运行、dispatch fail-open；
- Hook trait 没有 Block/decision 返回值；
- PipelineRegistry 不拥有 CommitHandler；
- SessionStore 可直接作为连续 emit 的唯一 mutable commit target；
- Agent Event derive Hook 原样转交 record；
- R4-A 前后 derive mapping、wire schema、64 KiB、seq/turn 恢复行为不变；
- tool call/result identity、input、status、content 不丢失；
- Turn/Step/round 顺序与 [`../loop/DESIGN.md`](../loop/DESIGN.md) 一致；
- event 不 import loop，legacy run identity 不产生 Run type。
