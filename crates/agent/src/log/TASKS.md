# agent::log — R3 tasks

> 当前状态：R3 实现完成，默认 `DiagnosticPersistence::Off` 仍关闭该链路。
>
> 目标：按已确认设计，把 Agent Event Log 从 `agent-core::event` 的同步文件 recorder 收敛为 `agent::log` 的 bounded queue + worker + file recorder。

## 设计门禁

- [x] `AgentEventRecord`、derive mapping 和 `AgentEventRecorder` port 留在 `agent-core::event`；
- [x] `QueuedAgentEventRecorder` 只做 bounded `try_send`，不执行文件 IO；
- [x] queue 满是可观测但成功的丢弃，不把 backpressure 传播到 AgentLoop；
- [x] `AgentEventLogWorker` 独占 receiver、flush 生命周期和 worker 状态；
- [x] `FileAgentEventRecorder` 迁移到 `agent::log`，落盘时才执行 JSONL 限制、truncate、preview 和简化；
- [x] queue 阶段保留完整 canonical `ToolCall` / `ToolResult` payload；
- [x] R3 `DiagnosticPersistence::Off` 不注册 Hook、不启动 worker、不创建 `runs/{run_id}.active.jsonl`；
- [x] `Agent::create`、`resume`、`reload` 和 worker start 要求 Tokio runtime；不提供同步 fallback；
- [x] R3 只暴露 `dropped_events`，不实现 `dropped_bytes`、byte-budget queue 或 metrics exporter；

## Review 批

| 批 | TASK | 主题 | 状态 |
|---|---|---|---|
| R1 | log-01–04 | policy、queue/worker、file recorder、conformance | ☑ |

## 实现批次

### TASK-log-01：policy 与 bootstrap 装配（R3）

- 定义 `SessionPersistence`、`DiagnosticPersistence`、`PersistenceConfig`；
- 由 `AgentConfig` 接收已解析 policy，`agent-core` 不读取 settings；
- 验证默认 `SessionPersistence::Items + DiagnosticPersistence::Off` 的关闭语义。
- **状态：** ☑

### TASK-log-02：queued recorder 与 worker

- 实现 bounded queue、`try_send`、`dropped_events` 和 `Degraded` 状态；
- 实现显式 `flush` 与 `status`；
- worker 错误 fail-open，不改变 Session commit 或 Agent turn 结果。
- **状态：** ☑

### TASK-log-03：file recorder 迁移

- 将 Agent Event 语义 writer 从 event core 移到本模块；
- 保持 `runId`、`seq`、`turn` 恢复和 `.active.jsonl` 路径契约；
- 迁移现有 JSONL/truncate 行为，并补充落盘简化元数据。
- **状态：** ☑

### TASK-log-04：conformance tests

- 覆盖 Off、队列溢出、顺序、flush、worker error、完整 payload 和无 runtime 错误；
- 每个测试注释场景、预期和不变量/副作用约束；
- 代码批次完成后运行 `just check`。
- **状态：** ☑
