# event 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

## Review 批

| 批 | TASK | 主题 | 状态 |
|---|---|---|---|
| **R1** | 01–03 | 删除 Run 与半成品观测，只保留 Turn → Session commit | ☑ |

---

### TASK-event-01: Turn commit 事实

- **做什么：** `TurnEvent` 只保留可持久化 SessionItem 的事实，并直接复用 canonical ToolCall / ToolResult。
- **范围：** `turn_event.rs`、session commit 映射
- **完成标准：** 所有变体都能同步提交且暴露所属 turn。
- **状态：** ☑

### TASK-event-02: Commit-only dispatcher

- **做什么：** `EventDispatcher` 直接持有一个 `CommitHandler`；删除 registry、hook、observe、trace context 与文件 recorder。
- **范围：** `commit_handler.rs`、`pipeline.rs`、`mod.rs`
- **完成标准：** dispatcher 精确提交一次并传播原错误。
- **状态：** ☑

### TASK-event-03: 契约与守门测试

- **做什么：** 同步 README/DESIGN/工程术语，并用单测守住 commit-only 边界和 Session 唯一写者。
- **范围：** `event/tests.rs`、当前 Rust 架构文档
- **完成标准：** workspace fmt、clippy、test 全绿；非归档契约不预设 observability 设计。
- **状态：** ☑
