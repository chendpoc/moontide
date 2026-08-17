# llm

> **对外使用说明** — 集成 `agent-core::llm` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)
> **状态：** R1–R6 已完成；48 tests。
> **系统边界：** [`crates/docs/agent-core.md`](../../../docs/agent-core.md)

---

## 这是什么

`llm` 是内核与模型 API 之间的**唯一边界**：

- **MoonTide 协议类型**（`Message`、`ModelRequest`、`ContentBlock` …）— 全 crate 共用
- **`LLMProvider`** — 流式调用端口
- **`run_model_call*`** — loop 应使用的入口（内部 fold，禁止自写）

HTTP、厂商 JSON/SSE、endpoint 对 loop **不可见**，由 `agent` 注入 `build_provider(...)`。

`Message` / `ModelRequest` 是 MoonTide 的 canonical provider-neutral 数据格式；完整的 `ModelRequest → provider wire request` 转换由 `llm::adapter` 持有，`context` 不参与 provider 转换。若 adapter 需要方法语法，只能使用其内部私有 extension trait，不向 `Message` 增加公共通用 transform trait。

---

## 设计原理（brief）

```text
  loop / model_input                agent（组合根）
         │                                │
         │  ModelRequest                  │ build_provider(family, config)
         ▼                                ▼
    run_model_call*  ──►  LLMProvider  ──►  adapter + normalize  ──►  HTTP/SSE
         │
         ▼
    ModelResponse / ModelResponseSnapshot
         │
         └──► event::MessageUpdate（流式 UI）
```

| 概念 | 含义 |
|------|------|
| **MoonTide 协议** | 内核 domain 类型（与厂商无关） |
| **AdapterFamily** | wire 形状（如 OpenAI Chat Completions） |
| **Preset** | 厂商配置（base_url、api_key）；在 `agent/`，不在 `llm` |

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`loop`** | `protocol` 类型、`run_model_call*` | `match ModelStreamEvent`、自写 fold、`adapter` |
| **`session`** | `protocol` 类型（`ContentBlock` 等） | `LLMProvider`、`stream` |
| **`context`** | `Message` | `ModelRequest` 构造、HTTP、adapter |
| **`model_input`** | `ModelRequest` / `Message` / `ToolSchema` | HTTP、adapter、请求 preflight |
| **`agent`** | `build_provider`、`AdapterFamily`、`AdapterConfig` | 在 loop 内硬编码 endpoint |
| **`cli`** | `ModelResponseSnapshot`、`ContentBlock`（渲染） | `ModelStreamEvent` |
| **测试** | `MockProvider`、`complete` 别名 | — |

---

## 公开 API 速查

### 协议类型（`llm::protocol`）

常用：`Message`、`ContentBlock`、`ToolSchema`、`ModelRequest`、`ModelResponse`、`StopReason`、`Usage`、`LlmError`。

### loop 入口（**首选**）

```rust
/// 无流式 UI
pub async fn run_model_call(
    provider: &dyn LLMProvider,
    request: ModelRequest,
) -> Result<ModelResponse, LlmError>;

/// 有流式 UI：每 fold 一步调用 on_update(snapshot)
pub async fn run_model_call_with_updates<F>(
    provider: &dyn LLMProvider,
    request: ModelRequest,
    on_update: F,
) -> Result<ModelResponse, LlmError>
where
    F: FnMut(ModelResponseSnapshot);
```

### 组合根（`agent` only）

```rust
pub fn build_provider(
    family: AdapterFamily,
    config: AdapterConfig,
) -> Box<dyn LLMProvider>;
```

### `LLMProvider`（一般仅 mock / adapter 实现）

```rust
pub trait LLMProvider: Send + Sync {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>>;
}
```

完整类型字段见 [`DESIGN.md`](DESIGN.md) §6。

---

## 典型用法

### loop：一次模型调用

```rust
let request = model_input::compile(
    &request_config,
    &system_prompt,
    messages,
    &tool_registry,
);

let response = run_model_call(provider.as_ref(), request).await?;
// response.content → 解析 tool_call / 文本
// response.stop_reason → EndTurn | ToolUse | …
```

### loop + 流式 UI + event

```rust
run_model_call_with_updates(provider.as_ref(), request, |snapshot| {
    dispatcher.emit(RunEvent::MessageUpdate { snapshot, .. })?;
}).await?;
// 结束后 loop emit LlmCallEnded、AssistantFinalized（见 event README）
```

### agent：注入 provider

```rust
let provider = build_provider(
    AdapterFamily::OpenAiChatCompletions,
    AdapterConfig {
        base_url: "https://api.deepseek.com".into(),
        api_key: std::env::var("DEEPSEEK_API_KEY")?,
    },
);
```

### cli：渲染（禁止碰流事件）

```rust
// 只读 ModelResponseSnapshot / ContentBlock
for block in &snapshot.content {
    match block {
        ContentBlock::Text { text } => render_markdown(text),
        ContentBlock::Thinking { thinking } => render_thinking(thinking),
        ContentBlock::ToolUse { name, .. } => render_tool_badge(name),
        _ => {}
    }
}
if let Some(PendingBlock::ToolUse { name, .. }) = &snapshot.pending {
    render_spinner(name);
}
```

---

## 与 `event` / `session` 的接缝

| 时机 | 模块 |
|------|------|
| 调模型前 | `event`：`LlmCallStarted` |
| 流式中 | `event`：`MessageUpdate { snapshot }` |
| 模型返回后 | `event`：`LlmCallEnded` → `AssistantFinalized` → session commit |
| session 存储 | 仅 `ModelResponse.content`（`ContentBlock`），无 `pending` |

---

## 错误处理

| `LlmError` | 含义 | loop 建议 |
|------------|------|-----------|
| `Cancelled { reason }` | 用户/父任务取消 | 正常结束 turn |
| `RequestFailed { kind, message }` | HTTP / 协议错误 | 打印 ERROR，REPL 继续 |

---

## 常见错误

| 做法 | 问题 |
|------|------|
| loop 里 `match ModelStreamEvent` | 违反 fold 唯一性；用 `run_model_call*` |
| 流式 UI 读 `ModelStreamEvent` | 应用 `ModelResponseSnapshot` |
| loop 直接 `build_provider` | endpoint 应留在 `agent` |
| 把 `pending` 写入 session | 只 commit `finish()` 后的 blocks |

---

## 进一步阅读

- 模块结构、normalize/adapter、不变量、单测：[`DESIGN.md`](DESIGN.md)
- TypeScript 历史 provider 方案：[`docs/archive/spec/llm-provider.md`](../../../../docs/archive/spec/llm-provider.md)
- 实现任务历史：[`TASKS.md`](TASKS.md)
