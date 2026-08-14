# llm 实现子任务

> [`README.md`](README.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

**TASK** = 实现跟踪（细）。**Review 批** = 你 `git diff` 的单位（合并 TASK，目标 ~300–1500 行，上限 2000）。

---

## Review 批（你要 review 的单位）

| 批 | TASK | 主题 | 预估 |
|----|------|------|------|
| **R1** | 01–03 | 契约层：crate + protocol + provider | ~630 |
| **R2** | 04–08 | normalize 层（common + openai_chat + anthropic 占位） | ~1030 |
| **R3** | 09–11 | adapter 层（工厂 + openai 实现 + anthropic stub） | ~800 |
| **R4** | 12 | 不变量单测 + workspace check | ~250 |

整模块 **4 轮 review**（非 12 轮）。R4 可并入 R3（合计 ~1050）若你希望更少停次。

---

## TASK 明细（实现跟踪）

| TASK | 做什么 | 预估 | Review 批 |
|------|--------|------|-----------|
| 01 | 建 crate + llm 空 mod | ~80 | R1 |
| 02 | MoonTide 协议类型 | ~350 | R1 |
| 03 | LLMProvider + Mock | ~200 | R1 |
| 04 | normalize/common | ~150 | R2 |
| 05 | openai_chat/tool | ~300 | R2 |
| 06 | openai_chat/thinking | ~150 | R2 |
| 07 | openai_chat/stream | ~350 | R2 |
| 08 | anthropic normalize 占位 | ~80 | R2 |
| 09 | adapter 工厂 | ~120 | R3 |
| 10 | openai_chat adapter | ~600 | R3 |
| 11 | anthropic stub | ~80 | R3 |
| 12 | 不变量单测 | ~250 | R4 |

---

### TASK-llm-01: crate scaffold

- **做什么：** 新建 agent-core 工程骨架，把 llm 模块挂进 workspace。
- **依赖：** 无
- **范围：** `Cargo.toml`、`src/lib.rs`、`src/llm/mod.rs`、根 workspace
- **预估 diff：** ~80
- **完成标准：** `cargo check -p moontide-agent-core`
- **状态：** ☑

### TASK-llm-02: protocol

- **做什么：** 内核 LLM 词汇表（Message、ModelRequest、StreamDelta…），无 HTTP。
- **依赖：** 01
- **范围：** `src/llm/protocol/*.rs`
- **预估 diff：** ~350
- **完成标准：** 对齐 README §6；protocol 测试通过
- **状态：** ☑

### TASK-llm-03: provider

- **做什么：** `LLMProvider` trait、`complete()`、MockProvider。
- **依赖：** 02
- **范围：** `provider.rs`、`tests.rs`（Mock 骨架）
- **预估 diff：** ~200
- **完成标准：** README §7；Mock 能吐 StreamDelta 序列
- **状态：** ☑

### TASK-llm-04: normalize/common

- **做什么：** request 校验、handoff 清洗。
- **依赖：** 02
- **范围：** `normalize/mod.rs`、`normalize/common.rs`
- **预估 diff：** ~150
- **完成标准：** validate / handoff 单测通过
- **状态：** ☑

### TASK-llm-05: normalize/openai_chat/tool

- **做什么：** block 模型 ↔ OpenAI tool_calls 互转。
- **依赖：** 04
- **范围：** `normalize/openai_chat/mod.rs`、`tool.rs`
- **预估 diff：** ~300
- **完成标准：** round-trip 单测通过
- **状态：** ☑

### TASK-llm-06: normalize/openai_chat/thinking

- **做什么：** reasoning ↔ thinking。
- **依赖：** 05
- **范围：** `normalize/openai_chat/thinking.rs`
- **预估 diff：** ~150
- **完成标准：** thinking 映射单测通过
- **状态：** ☑

### TASK-llm-07: normalize/openai_chat/stream

- **做什么：** SSE chunk → StreamDelta。
- **依赖：** 05
- **范围：** `normalize/openai_chat/stream.rs`
- **预估 diff：** ~350
- **完成标准：** fixture 单测通过
- **状态：** ☑

### TASK-llm-08: normalize/anthropic_messages

- **做什么：** Anthropic normalize 占位（pass-through）。
- **依赖：** 04
- **范围：** `normalize/anthropic_messages/mod.rs`
- **预估 diff：** ~80
- **完成标准：** 编译通过
- **状态：** ☑

### TASK-llm-09: adapter 工厂

- **做什么：** `AdapterFamily` + `build_provider`。
- **依赖：** 03, 08
- **范围：** `adapter/mod.rs`
- **预估 diff：** ~120
- **完成标准：** 覆盖已声明 Family
- **状态：** ☑

### TASK-llm-10: adapter/openai_chat

- **做什么：** DeepSeek Chat Completions 真实现。
- **依赖：** 07, 09
- **范围：** `adapter/openai_chat/mod.rs`
- **预估 diff：** ~600
- **完成标准：** mock HTTP；MessageEnd 收束
- **状态：** ☑

### TASK-llm-11: adapter/anthropic_messages stub

- **做什么：** Anthropic adapter 占位。
- **依赖：** 09
- **范围：** `adapter/anthropic_messages/mod.rs`
- **预估 diff：** ~80
- **完成标准：** stub 可构造
- **状态：** ☑

### TASK-llm-12: 不变量单测

- **做什么：** README 不变量守门。
- **依赖：** 03, 10
- **范围：** `tests.rs`
- **预估 diff：** ~250
- **完成标准：** `just check`
- **状态：** ☐
