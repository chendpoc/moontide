# event 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

**TASK** = 实现跟踪（细）。**Review 批** = 你 `git diff` 的单位（合并 TASK，目标 ~300–1500 行，上限 2000）。

---

## Review 批

| 批 | TASK | 主题 | 状态 |
|----|------|------|------|
| **R1** | 01–04 | RunEvent + TraceContext + PipelineRegistry + EventDispatcher + dispatch 单测 | ☑ |
| **R2** | 05–07 | derive + channel/kind 映射 + 64KiB 截断 + 映射单测 | ☑ |
| **R3** | 08–09 | session commit_from_event + agent-core observer 落盘接线 | ☑ |
| **R3-F1** | 12–13 | AgentEventRecorder 边界 + 文件持久化策略解耦 | ☑ |
| **R3-F2** | 14 | ToolCall / ToolResult typed payload 接缝 | ☑ |
| **R4** | 10–11 | EventBus + sidecar bridge | ☐ |

---

## R1：dispatch 骨架

### TASK-event-01: RunEvent + TraceContext

- **做什么：** `RunEvent` 枚举、`is_committable`、`TraceContext`。
- **范围：** `run_event.rs`、`trace_context.rs`。
- **完成标准：** Committable / Observational 分类与 DESIGN §4 一致。
- **状态：** ☑

### TASK-event-02: PipelineRegistry

- **做什么：** `HookHandler` / `CommitHandler` / `ObserveHandler` trait；`PipelineRegistryBuilder::build_frozen`。
- **范围：** `registry.rs`。
- **状态：** ☑

### TASK-event-03: EventDispatcher

- **做什么：** hook → commit → observe；`apply_event_to_trace`；observe fail-open。
- **范围：** `pipeline.rs`。
- **状态：** ☑

### TASK-event-04: R1 单测

- **做什么：** committable / observational / hook block / observe fail-open。
- **范围：** `tests.rs`。
- **完成标准：** `cargo test -p agent-core` 全绿。
- **状态：** ☑

---

## R2：derive 层

### TASK-event-05: AgentEventRecord + derive_agent_event

- **做什么：** `AgentEventRecord`、`AgentPhase`、`AgentChannel`；`derive_agent_event(ctx, event) -> Option<AgentEventRecord>`；RunEvent → channel/kind 映射（DESIGN §4.3 · agent-events.md）。
- **范围：** `derive.rs`、`mod.rs` re-export。
- **完成标准：** conversation / trace / context 映射表覆盖 Committable 与 Observational 事件。
- **状态：** ☑

### TASK-event-06: 64KiB 截断 + DeriveObserveHandler

- **做什么：** `truncate_record`；`DeriveObserveHandler` + `AgentEventRecorder` trait（R3 落盘接线）。
- **范围：** `derive.rs`。
- **状态：** ☑

### TASK-event-07: derive 映射单测

- **做什么：** UserPromptCommitted / TurnStarted·Ended / LlmCall / MessageUpdate 映射；截断守门。
- **范围：** `tests.rs`。
- **完成标准：** `cargo test -p agent-core` + clippy 全绿。
- **状态：** ☑

---

## R3：session + agent 联调

### TASK-event-08: commit_from_event（session）

- **做什么：** Committable `RunEvent` → `SessionItemDraft`（见 session TASK-session-09）。
- **范围：** `session/commit.rs`（跨模块）。
- **状态：** ☑

### TASK-event-09: agent-core observer 接线

- **做什么：** 在 agent-core 的 pipeline 集成测试中注册 session commit + `DeriveObserveHandler` JSONL recorder，验证端到端落盘。
- **范围：** `event/tests.rs`；生产 `agent` crate 装配待 agent crate 建立后补齐。
- **状态：** ☑

---

## R3-F1：record/recorder 边界修正

### TASK-event-12: AgentEventRecorder 端口

- **做什么：** 将 derive 层的输出能力命名为 `AgentEventRecorder`，统一使用 `append`；`DeriveObserveHandler` 只负责 derive 并转交完整 `AgentEventRecord`，不执行文件大小截断。
- **依赖：** TASK-event-06
- **范围：** `derive.rs`、`mod.rs`、`event/tests.rs`
- **预估 diff：** ~180 行
- **完成标准：** derive 单测不依赖文件格式策略，recorder 端到端测试通过。
- **状态：** ☑

### TASK-event-13: 文件记录适配器

- **做什么：** 将 64 KiB JSONL 编码、截断、seq/turn 恢复和文件追加集中到文件记录实现；保留当前 crate 内的临时装配入口，未来 agent 组合根建立后再迁移具体适配器。
- **依赖：** TASK-event-12
- **范围：** `agent_recorder.rs`、`file_writer.rs`、`event/tests.rs`、`README.md`、`DESIGN.md`
- **预估 diff：** ~260 行
- **完成标准：** 文件输出含换行不超过 64 KiB；重启恢复 seq/turn；错误 identity 不写入；文档术语与实现一致。
- **状态：** ☑

---

## R3-F2：tool typed payload 接缝

### TASK-event-14: 直接复用 ToolCall / ToolResult

- **做什么：** 将 tool RunEvent 收敛为 `ToolCallRecorded { call }` / `ToolResultRecorded { result }`；trace 与 Agent Event derive 只读 canonical payload，并保留 typed status。
- **依赖：** agent-core tools RB2
- **范围：** `run_event.rs`、`pipeline.rs`、`derive.rs`、`tests.rs`
- **完成标准：** event 不再声明重复字段组；call/result identity、input、status 与 content 映射测试通过。
- **状态：** ☑

---

## R4：bus + sidecar

### TASK-event-10: EventBus

- **做什么：** tokio broadcast；observe 之后 publish；失败忽略。
- **范围：** `bus.rs`。
- **状态：** ☐

### TASK-event-11: sidecar bridge

- **做什么：** bus 订阅 → Transport（后置）。
- **范围：** `agent` / `cli`。
- **状态：** ☐
