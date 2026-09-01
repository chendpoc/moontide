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
| **R7** | 19–23 | Agnes 初版；catalog 曾迁入 core、wire 曾按 model 推断 | 已完成但边界被后续修订 |
| **R8** | fix-01–08 | catalog 外移、resolved provider、显式 adapter option | ☑（待用户 diff review） |

R5–R6 = DESIGN §14 R2。建议 **R5 协议+builder+API**，**R6 全库迁移+测试**（两轮 review）。

R7 是历史实施批；其 catalog ownership 与 thinking 推断已被
[`llm-provider-config-fix.md`](../../../docs/llm-provider-config-fix.md) 的确认决策取代。

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

## R7：Agnes 初版（历史；当前边界由 R8 修订）

### TASK-llm-19: llm/catalog 模块（已被 R8 catalog 外移取代）

- **做什么：** `ProviderId`、`LlmModel`、`ProviderEntry` 静态表；`resolve_endpoint` / `apply_provider_switch`；**不含** `WireProfile` / thinking wire 枚举。
- **范围：** `catalog/mod.rs`、`catalog/tests.rs`。
- **完成标准：** DeepSeek + Agnes 条目；`resolve_endpoint` 单测；无 wire 策略类型。
- **状态：** ☑

### TASK-llm-20: thinking 出站迁入 normalize（model-prefix 推断已被显式 option 取代）

- **做什么：** `encode_request(&ModelRequest)` 去掉 `EncodeContext`；`thinking.rs` 增加 `encode_thinking_extensions`（Agnes `chat_template_kwargs`）。
- **范围：** `normalize/openai_chat/{mod,thinking}.rs`、`adapter/openai_chat/mod.rs`。
- **完成标准：** adapter 不再持有 wire 策略；Agnes thinking 单测在 normalize。
- **状态：** ☑

### TASK-llm-21: 移除旧 AdapterConfig/ProviderConfig wire 字段

- **做什么：** 删除旧 `wire_profile` / `ThinkingWirePolicy`。该历史任务随后由 R8 修订为 family-specific `AdapterConfig`，OpenAI variant 显式持有窄的 `OpenAiChatOptions`。
- **范围：** `adapter/mod.rs`、`agent/config.rs`、`agent/bootstrap.rs`。
- **完成标准：** 全 workspace 无 `WireProfile` / `ThinkingWirePolicy` 引用。
- **状态：** ☑

### TASK-llm-22: host 迁移至 catalog API（catalog owner 已改为 `agent::llm`）

- **做什么：** CLI/Desktop/settings 改调 `catalog::{resolve_endpoint, provider, models_for, apply_provider_switch}`；`agent` 薄 re-export + `resolve_provider_config`；删除 `agent/preset/`。
- **范围：** `cli/`、`moontide-desktop/`、`agent/src/lib.rs`。
- **完成标准：** host 不做 wire compat 决策；settings v2 provider 切换行为不变。
- **状态：** ☑

### TASK-llm-23: 文档与验收

- **做什么：** 更新 [`agnes-provider-integration.md`](../../../docs/agnes-provider-integration.md)、`llm/DESIGN.md` §10、`just check`。
- **状态：** ☑

---

## R1–R4（已完成，旧 StreamDelta）

| TASK | 状态 |
|------|------|
| 01–12 | ☑ |
