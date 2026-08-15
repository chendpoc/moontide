# llm 子任务示例（复制为 `src/llm/TASKS.md` 使用）

> 源自 [`src/llm/README.md`](../../../../crates/agent-core/src/llm/README.md) §2、§14、§15。
> **条目：** **做什么**（1–3 句）+ 依赖 + 范围 + 预估 + 完成标准。见 [`batch-implement/SKILL.md`](SKILL.md)。

## 批次建议

| 批 | TASK | 预估 diff | 说明 |
|----|------|-----------|------|
| 1 | 01 | ~80 | crate scaffold |
| 2 | 02 | ~350 | protocol |
| … | … | … | openai_chat normalize **逐 TASK 分批**，勿 05–07 合并 |
| 10 | 10 | ~600 | openai_chat adapter 单独一批 |

---

### TASK-llm-01: {标题}

- **做什么：** …
- **依赖：** 无
- **范围：** …
- **预估 diff：** ~80
- **完成标准：** …
- **状态：** ☐

### TASK-llm-02: protocol 类型

- **依赖：** 01
- **范围：** `src/llm/protocol/{mod,message,request,delta,error}.rs`
- **完成标准：** 类型与 README §6 一致；`cargo test -p agent-core protocol`（serde round-trip 若有）
- **状态：** ☐

### TASK-llm-03: LLMProvider + complete

- **依赖：** 02
- **范围：** `src/llm/provider.rs`、`src/llm/tests.rs`（MockProvider 骨架）
- **完成标准：** trait 签名与 README §7 一致；MockProvider 可产出合法 StreamDelta 序列
- **状态：** ☐

### TASK-llm-04: normalize/common

- **依赖：** 02
- **范围：** `src/llm/normalize/{mod,common}.rs`
- **完成标准：** `validate_request`、handoff 清洗入口存在；单测覆盖非法 request
- **状态：** ☐

### TASK-llm-05: normalize/openai_chat/tool

- **依赖：** 04
- **范围：** `src/llm/normalize/openai_chat/{mod,tool}.rs`
- **完成标准：** blocks ↔ OpenAI messages round-trip 单测通过
- **状态：** ☐

### TASK-llm-06: normalize/openai_chat/thinking

- **依赖：** 05
- **范围：** `src/llm/normalize/openai_chat/thinking.rs`
- **完成标准：** reasoning_content ↔ ThinkingDelta 映射单测
- **状态：** ☐

### TASK-llm-07: normalize/openai_chat/stream

- **依赖：** 05
- **范围：** `src/llm/normalize/openai_chat/stream.rs`
- **完成标准：** SSE chunk → StreamDelta；tool arguments 分片合并单测
- **状态：** ☐

### TASK-llm-08: normalize/anthropic_messages 骨架

- **依赖：** 04
- **范围：** `src/llm/normalize/anthropic_messages/mod.rs`
- **完成标准：** encode/decode 入口存在（pass-through 可）；编译通过
- **状态：** ☐

### TASK-llm-09: adapter 工厂

- **依赖：** 03, 08
- **范围：** `src/llm/adapter/{mod,config}.rs`
- **完成标准：** `AdapterFamily` + `build_provider` 注册表；未知 family 返回明确错误
- **状态：** ☐

### TASK-llm-10: adapter/openai_chat

- **依赖：** 07, 09
- **范围：** `src/llm/adapter/openai_chat/mod.rs`
- **完成标准：** 实现 `LLMProvider`；集成测试可用 mock HTTP 或 recorded fixture
- **状态：** ☐

### TASK-llm-11: adapter/anthropic_messages stub

- **依赖：** 09
- **范围：** `src/llm/adapter/anthropic_messages/mod.rs`
- **完成标准：** stub 实现 `LLMProvider`（返回明确未实现错误或空 stream）；`build_provider` 可构造
- **状态：** ☐

### TASK-llm-12: 不变量与 MockProvider 单测

- **依赖：** 03, 10
- **范围：** `src/llm/tests.rs`
- **完成标准：** MessageEnd 唯一性、Tool 序列不变量；`just check` 全绿
- **状态：** ☐
