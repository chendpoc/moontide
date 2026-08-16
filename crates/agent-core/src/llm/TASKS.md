# llm 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

**TASK** = 实现跟踪（细）。**Review 批** = 你 `git diff` 的单位（合并 TASK，目标 ~300–1500 行，上限 2000）。

---

## Review 批

| 批 | TASK | 主题 | 状态 |
|----|------|------|------|
| **R1** | 01–03 | 契约层：crate + protocol + provider | ☑ |
| **R2** | 04–08 | normalize 层 | ☑ |
| **R3** | 09–11 | adapter 层 | ☑ |
| **R4** | 12 | 不变量单测（旧 StreamDelta） | ☑ |
| **R5** | 13–17 | 流式消费修订：ModelStreamEvent + Builder + loop API | ☑ |
| **R6** | 18 | 迁移 normalize/adapter/tests + `just check` | ☑ |

R5–R6 = DESIGN §14 R2。建议 **R5 协议+builder+API**，**R6 全库迁移+测试**（两轮 review）。

---

## R5：协议 + Builder + loop API

### TASK-llm-13: ModelStreamEvent

- **做什么：** `delta.rs` → `stream_event.rs`；`ModelStreamEvent` + `block_index`；`Finished` / `*Part` / `ToolUseFinished { input }`。
- **范围：** `protocol/stream_event.rs`、`protocol/mod.rs`；删 `delta.rs`。
- **完成标准：** serde round-trip；旧名无引用。
- **状态：** ☑

### TASK-llm-14: Snapshot + ResponseBuilder

- **做什么：** `snapshot.rs`、`response_builder.rs`；唯一 fold；`block_index` 交错单测。
- **范围：** `protocol/snapshot.rs`、`response_builder.rs`、`mod.rs` re-export。
- **完成标准：** Text/Thinking 交错顺序正确；`ToolUseFinished` → `ContentBlock::ToolUse`；无 `Finished` → `finish()` 报错。
- **状态：** ☑

### TASK-llm-15: run_model_call*

- **做什么：** `run_model_call`、`run_model_call_with_updates`；`complete` = 别名；删 `provider.rs` 内联 fold。
- **范围：** `provider.rs`。
- **完成标准：** 每 `apply` 调用 `on_update`；`run_model_call` 与 `finish()` 结果一致。
- **状态：** ☑

### TASK-llm-16: MockProvider 迁移

- **做什么：** `tests.rs` Mock 吐 `ModelStreamEvent`；builder / run_model_call 单测。
- **范围：** `tests.rs`。
- **完成标准：** provider_tests 全绿。
- **状态：** ☑

### TASK-llm-17: README / DESIGN / CONTEXT 对齐

- **做什么：** DESIGN checklist 旧名更新；README 拆分为对外用法；TypeScript 历史 `docs/archive/spec/llm-provider.md` 交叉引用（可选一句）。
- **状态：** ☑

---

## R6：normalize / adapter 迁移

### TASK-llm-18: 全库 StreamDelta → ModelStreamEvent

- **做什么：** `normalize/openai_chat/{stream,thinking,tool}`：`ToolUseFinished.input`；`block_index: 0`（OpenAI 族）；adapter + wiremock 测试更新。
- **范围：** `normalize/**`、`adapter/**`、`tests.rs` invariant tests。
- **完成标准：** `just check`；不变量 §11 全满足。
- **状态：** ☑

---

## R1–R4（已完成，旧 StreamDelta）

| TASK | 状态 |
|------|------|
| 01–12 | ☑ |
