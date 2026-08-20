# agent progress host events TASKS

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|---|---|---|---:|---|
| R2 | progress-01–04 | 完整事件、snapshot、finalized 与非阻塞宿主链路 | ~900 行 | 完成 |

## TASK 明细

### TASK-progress-01: Host event contract

- **做什么：** 增加完整的 `AssistantResponseSnapshot`、`AssistantFinalized`、`ToolCall`、`ToolResult` 和 typed `LlmCallEnded` 宿主事件；删除独立 `Thinking` event，并补齐 `ModelResponseSnapshot` 的公开导出。
- **依赖：** 无
- **范围：** `crates/agent/src/progress.rs`、`crates/agent/src/lib.rs`、`agent-core` event/loop contracts、相关文档
- **预估 diff：** ~220 行
- **完成标准：** `cargo test -p agent` 通过；公开类型携带完整 ToolCall/ToolResult payload、enum outcome，并可被外部宿主构造和匹配。
- **状态：** 完成

### TASK-progress-02: Call identity 与 snapshot fold

- **做什么：** 在 progress hook 内维护单活跃 call 的 `update_index` 和 finalized source identity，覆盖正常 call、retry、失败 attempt、tool-only finalized marker 和 tool round 顺序。
- **依赖：** TASK-progress-01
- **范围：** `crates/agent/src/progress.rs`、`crates/agent/src/tests.rs`
- **预估 diff：** ~300 行
- **完成标准：** snapshot 按 call 从 index 0 递增；retry 更换 call identity；每个 attempt 有一次 LlmCallEnded；finalized identity 正确；tool-only marker 不写入 Session。
- **状态：** 完成

### TASK-progress-03: Failure and observer conformance

- **做什么：** 验证 partial snapshot、每个 attempt 的 typed outcome、turn/provider error、observer error 和 Session commit 的边界；更新宿主契约状态文档。
- **依赖：** TASK-progress-02
- **范围：** `crates/agent/src/progress.rs`、`crates/agent/src/tests.rs`、`crates/agent/README.md`、`crates/agent/DESIGN.md`
- **预估 diff：** ~230 行
- **完成标准：** `just check` 通过；observer fail-open 且错误 turn 不伪造 finalized。
- **状态：** 完成

### TASK-progress-04: Non-blocking ProgressWorker

- **做什么：** 增加 agent 内部 ProgressWorker；ProgressHook 使用 bounded `try_send`，snapshot 支持 coalesce，生命周期事件保持顺序；队列溢出产生 resync 信号但不阻塞 AgentLoop。
- **依赖：** TASK-progress-01
- **范围：** `crates/agent/src/progress.rs`、agent composition root、相关文档和测试
- **预估 diff：** ~180 行
- **完成标准：** slow observer 不阻塞 AgentLoop；observer error fail-open；one-shot 宿主可显式 flush；队列溢出暴露 `dropped_events` / `resync_required`；无 runtime 不提供同步 fallback。
- **状态：** 完成

## 实现约束

- UI 渲染仍由 CLI/Desktop/headless frontend 自己决定；
- 不把 snapshot 写入 Session Item Log 或 Agent Event Log；
- R2 已确认的 `agent-core::TurnEvent` contract 变更必须与 event/loop 设计同步实现；其他公开字段变更仍需回到架构对齐；
- 不引入具体 UI framework、IPC、Runtime Host、scheduler 或多 session 并发；ProgressWorker 仅限 agent 内部 observer consumer。
