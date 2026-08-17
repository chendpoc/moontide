# llm — 技术设计

> **读者：** 实现者、代码审查。对外集成见 [`README.md`](README.md)。
> **状态：** R1–R6 已完成；48 tests。
> **关联：** [`crates/docs/agent-core.md`](../../../docs/agent-core.md) · [`../../README.md`](../../README.md)

---

## 1. 职责与边界

内核唯一的 LLM 边界：`loop` / `context` / `session` 只依赖 **MoonTide 协议类型** 与 **`LLMProvider` trait**；HTTP、厂商 JSON/SSE、endpoint 关在 `adapter/` + `normalize/`，由 `agent` 组合根注入。

**不在本 mod：** preset 表、model 路由、`resolveRoute` → `agent/preset/`。

---

## 2. 模块结构

```text
llm/
  README.md                 # 对外使用说明
  DESIGN.md                 # 本文
  TASKS.md
  mod.rs
  protocol/
    message.rs              # Role, Message, ContentBlock, ToolSchema
    request.rs              # ModelRequest, ModelResponse, StopReason, Usage
    stream_event.rs         # ModelStreamEvent
    snapshot.rs             # ModelResponseSnapshot, PendingBlock
    error.rs                # LlmError, CancelReason, RequestFailureKind
  response_builder.rs       # ModelResponseBuilder（唯一 fold）
  provider.rs               # LLMProvider + run_model_call*
  normalize/
    common.rs
    openai_chat/            # tool, thinking, stream
    anthropic_messages/
  adapter/
    openai_chat/
    anthropic_messages/
  tests.rs
```

---

## 3. 分层与依赖

```text
loop / context / session / model_input
    └── llm::protocol + llm::run_model_call[_with_updates]
    └── （禁止）直接 match ModelStreamEvent / 自行 fold

agent（组合根）
    └── llm::adapter::build_provider(family, config)

llm::adapter/{family}
    └── protocol + normalize::{family} + reqwest

llm::normalize/{family}
    └── protocol + normalize::common
```

| 层 | 知道什么 | 禁止 |
|----|----------|------|
| `protocol` | MoonTide 类型 | HTTP、SDK、base_url、preset |
| `LLMProvider` | `stream` → `ModelStreamEvent` | 路由、重试、session 写入 |
| `run_model_call` | `ModelResponse` | 直接消费 `ModelStreamEvent` |
| `ModelResponseBuilder` | Snapshot / Response | 第二套 fold |
| `normalize` | 跨 wire 语义等价 | HTTP、vendor 名 |
| `adapter` | wire serde + SSE | loop、权限、tool 执行 |

---

## 4. 三个概念

| 概念 | 含义 | 例子 |
|------|------|------|
| **MoonTide 协议** | 内核 domain 类型 | `ContentBlock`, `ModelRequest` |
| **AdapterFamily** | wire 协议族 | `OpenAiChatCompletions`, `AnthropicMessages` |
| **Preset** | 厂商接入配置 | `deepseek`, `openrouter` |

```text
preset "deepseek"   × OpenAiChatCompletions → https://api.deepseek.com/chat/completions
preset "openrouter" × OpenAiChatCompletions → https://openrouter.ai/api/v1
```

---

## 5. 调用链

```text
出站:
  ModelRequest
    → normalize::common::validate_request
    → normalize::{family}::encode_request
    → adapter::{family}::post_stream

入站:
  raw SSE
    → adapter parse
    → normalize StreamDecoder → ModelStreamEvent
    → ModelResponseBuilder::apply
    → ModelResponseSnapshot / ModelResponse
    → loop 经 run_model_call*；TurnEvent 转发 snapshot
```

### 5.1 出站转换 owner

`Message` 是 MoonTide provider-neutral 的 canonical model-input record。它表达 role、content block、tool use/result 等内部语义，不表达 OpenAI、Anthropic 或 DeepSeek 的 wire JSON。

完整出站转换的 owner 是 `llm::adapter`：

```text
ModelRequest
  ├── system / messages / tools / request config
  └── adapter::{family}::encode_request
          └── provider wire request
```

`context` 只负责 `SessionItem → Message`，不得 import provider adapter；`llm::adapter` 可以在内部拆出 message、tool schema 和 request config 的转换 helper。R1 不在 `Message` 上公开通用 `Transform<Target>` trait，因为 provider-specific output/error types 不应反向污染 `protocol`。

若某个 adapter 确实需要方法语法，可定义 adapter 私有 extension trait 并为 `Message` 实现；这不形成 MoonTide protocol 的公共扩展点。

---

## 6. 类型（`protocol/`）

### 6.1 消息

```rust
enum Role { User, Assistant }

enum ContentBlock {
    Text { text: String },
    Thinking { thinking: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, content: ToolResultContent },
}

struct Message { role: Role, content: MessageContent }
struct ToolSchema { name: String, description: String, input_schema: Value }
```

### 6.2 请求 / 响应

```rust
struct ModelRequest {
    model: String,
    system: String,
    messages: Vec<Message>,
    tools: Vec<ToolSchema>,
    max_tokens: u32,
    thinking_level: Option<ThinkingLevel>,
    session_id: Option<String>,
}

struct ModelResponse {
    content: Vec<ContentBlock>,
    stop_reason: StopReason,
    usage: Option<Usage>,
    model: Option<String>,
}
```

### 6.3 `ModelStreamEvent`

```rust
enum ModelStreamEvent {
    TextPart { block_index: u32, text: String },
    ThinkingPart { block_index: u32, thinking: String },
    ToolUseStarted { id: String, name: String },
    ToolUsePart { id: String, input_json: String },
    ToolUseFinished { id: String, name: String, input: Value },
    Finished { stop_reason: StopReason, usage: Option<Usage> },
}
```

- **`block_index`：** assistant 消息内块序号；变化时 Builder flush。
- **不在此枚举：** `ResponseStarted`（loop / `TurnEvent`）、全文 `ResponseCompleted`（`finish()`）。

### 6.4 Snapshot + Builder

```rust
struct ModelResponseSnapshot {
    content: Vec<ContentBlock>,
    pending: Option<PendingBlock>,
    stop_reason: Option<StopReason>,
    usage: Option<Usage>,
    model: Option<String>,
}

impl ModelResponseBuilder {
    fn apply(&mut self, event: ModelStreamEvent) -> Result<ModelResponseSnapshot, LlmError>;
    fn snapshot(&self) -> ModelResponseSnapshot;
    fn finish(self) -> Result<ModelResponse, LlmError>;
}
```

**fold 规则：** `block_index` 或 Text/Thinking 类型变化 → flush；`ToolUseFinished` → `ContentBlock::ToolUse`；`Finished` → flush + 元数据。

### 6.5 错误

```rust
enum LlmError {
    Cancelled { reason: CancelReason },
    RequestFailed { kind: RequestFailureKind, message: String },
}
```

---

## 7. `LLMProvider` 与 loop 入口

```rust
trait LLMProvider: Send + Sync {
    fn stream(&self, request: ModelRequest)
        -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>>;
}

async fn run_model_call(provider: &dyn LLMProvider, request: ModelRequest)
    -> Result<ModelResponse, LlmError>;

async fn run_model_call_with_updates<F>(
    provider: &dyn LLMProvider,
    request: ModelRequest,
    on_update: F,
) -> Result<ModelResponse, LlmError>
where
    F: FnMut(ModelResponseSnapshot);
```

**与 `TurnEvent`：** `on_update` 只把 snapshot 交还 loop；当前不定义跨模块流式观测事件。完整响应确定后，loop emit `AssistantFinalized` 进入 Session Item Log。

### Snapshot 供给 vs 渲染

| 半边 | 负责方 |
|------|--------|
| 供给 | `llm`：`on_update(snapshot)` |
| 渲染 | `cli`：节流、markdown、spinner |

Session 落盘：仅 `finish()` 后 `ModelResponse.content`，不含 `pending`。

---

## 8. Adapter

```rust
enum AdapterFamily {
    OpenAiChatCompletions,
    AnthropicMessages,
}

struct AdapterConfig { base_url: String, api_key: String }

fn build_provider(family: AdapterFamily, config: AdapterConfig) -> Box<dyn LLMProvider>;
```

---

## 9. Normalize

- 一级目录与 `AdapterFamily` 1:1
- 族内：`tool.rs` / `thinking.rs` / `stream.rs`
- 跨族：`common.rs`（validate、handoff 清洗）
- 入站解码：`StreamDecoder` 有状态，在 adapter 内；encode 走无状态 `encode_request`

### 新增 AdapterFamily checklist

```text
☐ AdapterFamily enum
☐ adapter/{family}/ 实现 LLMProvider
☐ normalize/{family}/ encode + decode
☐ build_provider 注册
☐ 单测：tool round-trip 或 stream → Finished
```

---

## 10. Preset（`agent/preset/`）

```rust
struct Preset {
    id: String,
    adapter_family: AdapterFamily,
    base_url: String,
    api_key_env: String,
}
```

首版默认：`deepseek` · `OpenAiChatCompletions`。

---

## 11. 不变量

1. 成功 `stream`：**恰好一个** `Finished`，且为最后一项
2. Tool 流：`ToolUseStarted` → `ToolUsePart*` → `ToolUseFinished { input }`
3. `block_index`：同 index 内类型一致；tool 不占 text/thinking index
4. **fold 唯一性：** 仅 `ModelResponseBuilder`
5. `ModelRequest.messages` 非空；`system` 可空串
6. 取消：`LlmError::Cancelled`，不用 `Finished`
7. `normalize` 不 import `adapter`

---

## 12. 边界情况

| 场景 | 层 | 策略 |
|------|-----|------|
| handoff 后 history 含不支持的 block | `normalize::common` | strip，不 panic |
| OpenAI `tool_calls.arguments` 分片 | `openai_chat/stream` | 合并后 `ToolUseFinished` |
| DeepSeek thinking | `openai_chat/thinking` | `ThinkingPart` |
| HTTP 4xx/5xx | `adapter` | `RequestFailed` |
| 用户 abort | `loop` + provider | `Cancelled { User }` |

---

## 13. 决策记录

1. MoonTide 协议 = block 模型；厂商差异在 adapter + normalize
2. Adapter 按协议族、Preset 按厂商
3. Normalize：family 一级 + 族内 concern；common 仅跨族
4. 首版 DeepSeek × `OpenAiChatCompletions`
5. 对外 trait 仅 `LLMProvider`
6. 流式：`ModelStreamEvent` + Builder；loop 经 `run_model_call*`
7. 旧名废弃：`StreamDelta` / `MessageEnd` → `ModelStreamEvent` / `Finished`
8. `Message` canonical record 与 provider wire payload 分离；完整转换由 adapter 持有，不由 context 或 protocol 类型持有

---

## 14. 实现范围

| 交付 | 状态 |
|------|------|
| `protocol/` + `LLMProvider` | ✓ R1 |
| normalize / adapter 层 | ✓ R2–R3 |
| 不变量单测 | ✓ R4 |
| `ModelStreamEvent` + Builder + `run_model_call*` | ✓ R5–R6 |
| `agent/preset` deepseek | 随 agent 模块 |
| Responses / Gemini 族 | 后置 |

---

## 15. 单测方向

- `ModelResponseBuilder`：`block_index` 交错、`ToolUseFinished`、`Finished` 收束
- `run_model_call_with_updates`：闭包收到单调 `snapshot`
- `normalize/openai_chat/stream`：分片合并 `input`
- `MockProvider`：可控事件序列
- `build_provider`：注册表覆盖各 `AdapterFamily`
