# model_input

`ModelRequest` 的**唯一运行时组装边界**：消费已解析的 turn config、system、materialized messages 与冻结 tool registry，产出 provider-neutral `llm::protocol::ModelRequest`（**compile** = 结构映射，非 prompt 生成或 provider 编码）。

**设计：** [`DESIGN.md`](../../DESIGN.md#model_input)

## 公开入口

- `SystemPrompt` — 单 turn 已解析的 system 内容（immutable 至 turn 结束）
- `LlmCallConfig` — 单次 model call 快照（model、tokens、thinking、continuity 等；endpoint/secret 由组合根解析后注入）
- `ContinuityHint` — 可选 server-side continuity（如 `PreviousResponseId`）
- `compile(...)` — `pub(crate)`；唯一 caller 为同 crate 的 `loop`

`compile` 不返回 `Result`：schema 与 registry 不变量在 `ToolRegistry::new` 已守门；model/messages/max_tokens preflight 由 `llm` 负责。tool schema 按 registry 稳定顺序轻量映射，不改写 JSON Schema 关键词。

## 生命周期

- **Turn 边界：** 组合根解析一次 `SystemPrompt` 与 `LlmCallConfig`
- **Step 边界：** 每次 model call 前重新 `compile`（messages 随 tool 交互变化）

`TurnInput.config` 即 `LlmCallConfig`；同一 turn 内 config 与 system 可跨多次 compile 复用。

## 调用边界

不 import `agent`、`loop`、`context`、`session` 或 `event`。上层单向调用本模块；messages 语义 shaping 归 `context`。

## 相邻模块

[`context`](../context/README.md) · [`loop`](../loop/README.md) · [`tools`](../tools/README.md) · [`llm`](../llm/README.md)
