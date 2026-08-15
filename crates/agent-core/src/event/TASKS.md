# event 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

**TASK** = 实现跟踪（细）。**Review 批** = 你 `git diff` 的单位（合并 TASK，目标 ~300–1500 行，上限 2000）。

---

## Review 批

| 批 | TASK | 主题 | 状态 |
|----|------|------|------|
| **R1** | 01–04 | RunEvent + TraceContext + PipelineRegistry + EventDispatcher + dispatch 单测 | ☑ |
| **R2** | 05–07 | derive + channel/kind 映射 + 64KiB 截断 + 映射单测 | ☑ |
| **R3** | 08–09 | session commit_from_event + agent wiring + DeriveObserveHandler 落盘 | ☑ |
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

- **做什么：** `truncate_record`；`DeriveObserveHandler` + `AgentEventWriter` trait（R3 落盘接线）。
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

### TASK-event-09: agent 装配

- **做什么：** `PipelineRegistry` 注册 session commit + `DeriveObserveHandler` JSONL writer。
- **范围：** `agent` crate。
- **状态：** ☑

---

## R4：bus + sidecar

### TASK-event-10: EventBus

- **做什么：** tokio broadcast；observe 之后 publish；失败忽略。
- **范围：** `bus.rs`。
- **状态：** ☑

### TASK-event-11: sidecar bridge

- **做什么：** bus 订阅 → Transport（后置）。
- **范围：** `agent` / `cli`。
- **状态：** ☑
