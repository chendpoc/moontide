# agent log（R3）

> **性质：** Agent 组合根中的 Agent Event Log 诊断持久化模块。
> **边界：** 不负责 Session Item Log，不负责 Progress frontend rendering。
> **当前阶段：** R3 已实现；默认仍关闭诊断持久化。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。

## 1. 这是什么

`agent::log` 将 `agent-core::event` 派生的完整 `AgentEventRecord` 通过有界队列异步写入 Agent Event Log。

```text
R3:
TurnEvent dispatch
  → agent-core::event::derive_agent_event
  → QueuedAgentEventRecorder
  → AgentEventLogWorker
  → FileAgentEventRecorder
  → .moontide/runs/{run_id}.active.jsonl
```

Agent Event Log 是诊断观测，不是 Session Item Log 的替代品。它可以丢失，不参与 resume、materialize、permission、retry 或 turn 决策。

## 2. 谁该用什么

| 调用者 | 可用 | 禁止 |
|---|---|---|
| **agent bootstrap** | 按 `DiagnosticPersistence` 装配 worker | 把诊断日志作为 Session 恢复源 |
| **agent host** | R3 读取 `AgentEventLogStatus`、显式 flush | 根据诊断日志恢复 Session |
| **agent-core::event** | 提供 `AgentEventRecord` 和 recorder port | 读取 settings.json、创建 Tokio worker |
| **session** | 只维护 Session Item Log | 写 Agent Event Log |
| **frontend** | 通过 Progress 消费实时状态 | 依赖 Agent Event Log 做实时渲染 |

## 3. Persistence policy

policy 由 CLI/frontend 从 `<cwd>/.moontide/settings.json` 解析，再注入 `AgentConfig`：

```json
{
  "version": 1,
  "persistence": {
    "session": "items",
    "diagnostic": "off"
  }
}
```

默认仍是 `SessionPersistence::Items + DiagnosticPersistence::Off`：创建 Session，运行
`TurnEvent dispatch` 和 Progress，但不注册 Agent Event Hook、不启动 Agent Event Log
worker，也不创建 active JSONL 文件。设置为 `Errors`、`Normal` 或 `Debug` 时，bootstrap
注册 post-commit `DeriveAgentEventHook`、启动独立 worker 并创建
`runs/{run_id}.active.jsonl`。

policy 的记录范围：

- `Errors`：仅 LLM failed/cancelled 和非 succeeded 的 tool result；
- `Normal`：生命周期、prompt/final、LLM call、tool call/result，过滤高频 snapshot；
- `Debug`：保留所有 derived records，文件 writer 仍执行 64 KiB 截断；
- `Off`：完全关闭该诊断链路。

## 4. Worker status

R3 才要求以下 Agent Event Log 状态：

```rust
pub struct AgentEventLogStatus {
    pub state: AgentEventLogState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub last_error: Option<String>,
}
```

`dropped_bytes`、byte-budget queue 和 metrics exporter 后置。worker 丢弃事件时进入 `Degraded`，但不改变 AgentLoop 结果。

## 5. 常见错误

- 把 Agent Event Log 当成 Session resume 的事实源；
- 在 `DeriveAgentEventHook` 中直接执行文件 IO；
- 让 queue 满时等待 worker；
- 让诊断持久化 policy 进入 `agent-core::session`；
- 在 R2 强制要求 Tokio runtime 以启动未使用的 diagnostic worker；
- 把 Agent Event Log 当成 Session resume 的事实源。
