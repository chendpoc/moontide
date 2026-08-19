# 日志与 Session 设计

> 状态：R2 当前路径已确认；Session Item Log 契约已实现，Progress 是当前宿主事件路径；Agent Event Log 保留为 R3/可选诊断能力。

本文统一定义 Session Item Log、Agent Event Log、Progress stream 和项目级 persistence policy。它不把三条链路合并成一种日志。

## 1. 核心结论

```text
                         ┌─ Session Item Log ───────→ resume / materialize
TurnEvent dispatch ──────┼─ Progress queue ──────────→ frontend
                         └─ Agent Event Log ─────────→ R3 optional diagnostics
```

| 链路 | Owner | 目的 | 默认是否落盘 | 丢失影响 |
|---|---|---|---:|---|
| Session Item Log | `agent-core::session` | 模型可见、resume 必需的 canonical facts | 是 | 影响 resume 和后续请求历史 |
| Agent Event Log | `agent::log` | 可选生命周期、调用和诊断观测 | R3 可选 | 影响诊断，不影响 resume |
| Progress stream | `agent::progress` | frontend 实时渲染 | 否 | frontend 需要 resync |

核心原则：**Session Item Log 是唯一恢复事实源；TurnEvent dispatch 是唯一事件入口；Progress 服务实时消费；Agent Event Log 只在需要诊断持久化时启用。**

R2 的实际运行路径只有 `TurnEvent dispatch → Session Item Log + Progress`。Agent Event
Log 的 schema、recorder port 和组合根 owner 可以提前定义，但 queue、worker 和文件
持久化不属于 R2 必需实现。

## 2. 文件与事实源

```text
<cwd>/.moontide/
├── settings.json
├── sessions/
│   └── {YYYY-MM-DD}/
│       ├── {session_id}.meta.json       # SessionHeader
│       └── {session_id}.log.jsonl       # Session Item Log
└── runs/
    └── {run_id}.active.jsonl            # Agent Event Log（R3 optional）
```

Session 使用本地日期分区；Agent Event 使用当前 legacy `run_id` 分区和 `.active.jsonl` 文件名。resume 只读取对应 Session Item Log，不依赖 Agent Event Log、Progress queue 或 frontend 状态。

## 3. Session Item Log

Session Item Log 保存模型可见或恢复所需的 canonical `SessionItem`：

- `UserMessage`；
- 非空的 `AssistantMessage`；
- `ToolCall`；
- `ToolResult`；
- 已进入 Session 契约的 `Compaction` / checkpoint facts。

`AssistantFinalized` 的非空 blocks 在 commit 后进入 Session Item Log。tool-only response 可以发送空 finalized marker 关闭运行时 draft，但空 marker 不写入 Session Item Log。

不变量：

1. Session Item Log 是唯一恢复事实源；
2. `seq` 连续，append 前校验，入 log 后内容冻结；
3. 模型可见内容先 commit，再发送请求；
4. header 外置，不作为可 materialize 的 SessionItem；
5. Session commit 失败必须暴露到 turn 边界，不能被观测 Hook 吞掉。

Session Item Log 属于正确性路径，不进入可丢弃 queue。当前 R2 只实现 `SessionPersistence::Items`；`Disabled` 保留为后续 memory-only SessionStore 设计，不在本批实现。

## 4. Agent Event Log（R3 optional）

Agent Event Log 由 `TurnEvent` derive 得到，记录“发生了什么以及怎么发生”，但不是 resume 所需事实。它是 R3 的可选诊断持久化能力，不是 R2 的默认运行路径。启用后，Agent Event Record 在 queue 中保留完整 canonical payload：

- turn / step / LLM attempt 生命周期；
- typed `LlmCallOutcome`；
- 完整 `ToolCall` / `ToolResult` payload；
- `AssistantFinalized`；
- 按 persistence policy 选择的 `MessageUpdate` snapshot；
- provider raw trace（仅 Debug，且必须经过脱敏策略）。

完整 record 只存在于派生和 queue 阶段。写入 JSONL 时才执行单条大小限制、截断、preview 或简化；发生简化时必须记录 `truncated` / `originalBytes`。

Agent Event Log 不反向参与：

- Session materialize；
- model request compile；
- permission / approval / retry / cancellation 决策；
- frontend 最终渲染状态。

### 4.1 模块 owner

```text
agent-core::event
  TurnEvent → AgentEventRecord
  AgentEventRecorder port

agent::log
  QueuedAgentEventRecorder
  AgentEventLogWorker
  FileAgentEventRecorder
  persistence policy / status
```

`session` 不实现 Agent Event Log。它只实现 Session Item Log 和 mutable `CommitHandler`。

### 4.2 R3 写入链路

```text
TurnEvent dispatch
  → DeriveAgentEventHook
      → QueuedAgentEventRecorder.try_send
          → AgentEventLogWorker
              → FileAgentEventRecorder
                  → {run_id}.active.jsonl
```

`DeriveAgentEventHook` 只 derive 并入队，不执行文件 IO。`QueuedAgentEventRecorder` 使用 bounded queue；队列满时不等待、不阻塞 AgentLoop，累计 `dropped_events` 并进入 `Degraded`。

队列满是诊断链路的预期丢失，不是 Agent turn 错误：recorder 记录计数并返回成功，保证
Hook 不把 queue backpressure 传入 commit 或 loop；只有 queue 已关闭、worker 已停止等
生命周期故障才进入 worker/observer 的诊断状态。

Agent Event Log worker 独占文件句柄、seq/turn 恢复、JSONL 编码、批量 flush 和文件生命周期。worker 不依赖 AgentLoop、SessionStore 或 frontend。

R2 不创建 Agent Event Log worker，不创建 `runs/{run_id}.active.jsonl`，也不向 Agent
公开 diagnostic flush/status API。后续只有出现崩溃诊断、独立进程观测、sidecar 消费或
持久化 replay 等真实消费者时，才实现本节链路。

## 5. Progress stream

Progress 是独立的实时消费链路：

```text
TurnEvent dispatch
  → ProgressHook.try_send
      → bounded ProgressQueue
          → ProgressWorker
              → ProgressObserver
                  → CLI / Desktop / headless frontend
```

Progress 是 R2 的实时消费链路；Agent Event Log 若在 R3 启用，才拥有自己的 queue、worker、状态和 flush handle。两者不共享持久化语义。任一 observer/diagnostic worker 的失败都不能改变 AgentLoop 的正确性结果。

Progress 事件要求：

- 每个 attempt 恰好一个 `LlmCallEnded`，携带 typed `LlmCallOutcome`；
- 每个成功 LLM call 恰好一个 `AssistantFinalized`；
- tool-only response 发送空 finalized marker，但不写 Session；
- ToolCall / ToolResult 携带完整 canonical payload；
- 不发送独立 `Thinking` event，frontend 从 `AssistantResponseSnapshot` 渲染 thinking；
- snapshot 可以 coalesce，生命周期事件保持顺序；
- Progress 丢失时 frontend 从 Session Item Log 和 Agent turn result 重建状态。

### 5.1 Runtime 要求

`Agent::create`、`Agent::resume` 和 `Agent::reload` 都要求调用方已经运行在 Tokio runtime 内。ProgressWorker 和 AgentEventLogWorker 不提供无 runtime 的同步 observer / file writer fallback。

## 6. Persistence policy

Persistence policy 由 CLI/frontend 解析，写入项目级 `<cwd>/.moontide/settings.json`，再作为已解析的 `PersistenceConfig` 注入 `AgentConfig`。`agent-core` 不读取 settings.json。

```rust
enum SessionPersistence {
    Items,
    Disabled, // reserved; R2 does not implement
}

enum DiagnosticPersistence {
    Off,
    Errors,
    Normal,
    Debug,
}

struct PersistenceConfig {
    session: SessionPersistence,
    diagnostic: DiagnosticPersistence,
}
```

settings 示例：

```json
{
  "version": 1,
  "persistence": {
    "session": "items",
    "diagnostic": "off"
  }
}
```

优先级：

```text
默认值 → .moontide/settings.json → 环境变量 → CLI args
```

默认值：

```text
SessionPersistence    = Items
DiagnosticPersistence  = Off
```

默认 `SessionOnly` 的装配结果：

```text
Items + Off
  → 创建 SessionStore
  → 不注册 Agent Event Log Hook
  → 不创建 Agent Event Log worker
  → 不创建 runs/{run_id}.active.jsonl
  → Progress 是否启用由 frontend observer / trace mode 独立决定
```

`DiagnosticPersistence::Errors` 的错误事件分类在实现该模式前必须单独定义；当前实现批只要求 `Off` 的关闭语义和 `Normal` / `Debug` 的后续扩展位置。

## 7. Worker API 原则

Progress 和 Agent Event Log 不抽象成一个泛化 `Worker<T>` trait。两者丢失语义、flush 语义和状态字段不同。

R2 Progress 最小状态：

```rust
pub enum ProgressWorkerState {
    Running,
    Degraded,
    Stopped,
}

pub struct ProgressStatus {
    pub state: ProgressWorkerState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub resync_required: bool,
    pub last_error: Option<String>,
}
```

R3 Agent Event Log 最小状态：

```rust
pub struct AgentEventLogStatus {
    pub state: AgentEventLogState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub last_error: Option<String>,
}
```

R2 不要求 Agent Event Log 的 `dropped_bytes`、byte-budget queue、metrics exporter、flush
或持久化 status API；这些属于 R3 诊断资源能力。

## 8. Plugin / Hook 边界

普通 plugin 只能注册 post-commit observer。Hook 不得 Block、Approve、Cancel、Retry 或改变 loop 决策；需要事件前决策时使用 permission、approval、cancellation 或其他显式 API。

## 9. 双写原则

```text
模型可见，或 resume 后必须知道？ → Session Item Log
只为诊断过程和性能？             → Agent Event Log / logger
只为实时展示？                    → Progress stream
```

生命周期事实可以进入不同语义的流，但不是重复写同一份日志：Session 记录 canonical facts，Agent Event Log 记录完整观测，Progress 只服务实时 frontend。

## 10. 非目标

- 不用 Agent Event Log 恢复 Session；
- 不在 R2 实现 Agent Event Log queue、worker 和文件持久化；
- 不把每个 token 永久保存为默认行为；
- 不把 Progress snapshot 写入 Session Item Log；
- 不让 Hook 同步执行文件 IO；
- 不引入无界 queue；
- 不在 R2 实现 `SessionPersistence::Disabled`；
- 不为当前单窗口、单活跃 Session、Turn 串行场景提前引入 daemon、IPC 或 multi-session scheduler。
