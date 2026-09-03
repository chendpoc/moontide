# llm

内核与模型 API 之间的唯一边界：MoonTide 协议类型、`LLMProvider` 端口与 `run_model_call*`；HTTP 与厂商 wire 由 `adapter/` + `normalize/` 封装，组合根注入。

**设计：** [`DESIGN.md`](../../DESIGN.md#llm)

## 公开入口

- `llm::protocol::*` — `Message`、`ModelRequest`、`ModelResponse`、`ContentBlock`、`ToolSchema`、`ModelStreamEvent`、`ModelResponseSnapshot`
- `LLMProvider` — `stream(ModelRequest) → Stream<ModelStreamEvent>`
- `run_model_call` / `run_model_call_with_updates` — loop 应使用的调用入口（内部 fold 为 `ModelResponseBuilder`）
- `ModelResponseBuilder` — 流式事件唯一 fold
- `AdapterFamily`、`LlmCallConfig`、`AdapterConfig`、`ResolvedProtocolProfile` — provider-neutral 调用与装配 config
- `adapter::build_provider` — 组合根装配 concrete provider

## 调用边界

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| `loop` | `protocol`、`run_model_call*` | 自写 stream fold、硬编码 endpoint |
| `model_input` | `ModelRequest` / `Message` / `ToolSchema` | HTTP、adapter |
| `session` / `context` / `event` | `protocol` 类型 | `LLMProvider` |
| `agent` | `build_provider`、`AdapterConfig` | 在 loop 内构造 wire |
| `cli` | `ModelResponseSnapshot`（渲染） | 直接消费 `ModelStreamEvent` |

retry、cancellation policy 与 Session 写入不属于本 mod；catalog 与 credential 解析在 `agent::llm`。

## 相邻模块

[`context`](../context/README.md) · [`model_input`](../model_input/README.md) · [`loop`](../loop/README.md) · [`session`](../session/README.md) · [`event`](../event/README.md)
