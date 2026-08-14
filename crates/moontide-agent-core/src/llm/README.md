# llm

> **职责：** 定义 MoonTide 模型调用契约（协议类型 + `LLMProvider` 端口），并通过 adapter / normalize 与厂商 wire 协议解耦。
> **状态：** 设计已定；实现 / 测试完成（首版范围见 §14）。
> **关联：** [`docs/spec/llm-provider.md`](../../../../docs/spec/llm-provider.md) · [`../../README.md`](../../README.md)

---

## 1. 职责一句话

内核唯一的 LLM 边界：`loop` / `context` / `session` 只依赖 **MoonTide 协议类型** 与 **`LLMProvider` trait**；HTTP、厂商 JSON/SSE 形状、endpoint 选择全部关在 `adapter/` + `normalize/`，由 `agent` 组合根注入。

---

## 2. 模块结构

```text
llm/
  README.md                 # 本文
  mod.rs
  protocol/                 # MoonTide 协议（稳定 domain 层，无 IO）
    mod.rs
    message.rs              # Role, Message, ContentBlock, ToolSchema
    request.rs              # ModelRequest, ModelResponse, StopReason, Usage
    delta.rs                # StreamDelta
    error.rs                # LlmError, CancelReason, RequestFailureKind
  provider.rs               # trait LLMProvider
  normalize/                # 语义转换（纯函数，无 HTTP）
    mod.rs                  # 按 AdapterFamily 分发
    common.rs               # 跨族：validate、handoff 清洗
    openai_chat/            # OpenAiChatCompletions 族
      mod.rs                # encode_request / decode_stream 编排入口
      tool.rs
      thinking.rs
      stream.rs
    anthropic_messages/     # AnthropicMessages 族（首版可薄 / pass-through）
      mod.rs
  adapter/                  # wire 编解码 + transport（loop 不可见）
    mod.rs                  # AdapterFamily, AdapterConfig, build_provider
    openai_chat/
      mod.rs
    anthropic_messages/
      mod.rs
  tests.rs
```

**不在本 mod：** preset 表、model 路由、`resolveRoute` → 归属 `agent/preset/`（组合根）。

---

## 3. 分层与依赖方向

```text
loop / context / session / prompt
    └── llm::protocol + llm::LLMProvider

agent（组合根）
    └── llm::adapter::build_provider(family, config)
    └── preset::resolve_provider(...)

llm::adapter/{family}
    └── llm::protocol + llm::normalize::{family} + transport (reqwest)

llm::normalize/{family}
    └── llm::protocol + llm::normalize::common
```

| 层 | 知道什么 | 禁止 |
|----|----------|------|
| `protocol` | MoonTide 类型 | HTTP、SDK、base_url、preset |
| `LLMProvider` | `stream(ModelRequest)` | 路由、重试、session 写入 |
| `normalize` | 跨 wire 语义等价 | HTTP、具体 vendor 名 |
| `adapter` | 一种 wire 协议的 serde + SSE | loop 逻辑、权限、tool 执行 |
| `agent/preset` | preset × adapter_family × endpoint | 定义 MoonTide 协议类型 |

---

## 4. 三个概念（勿混）

| 概念 | 含义 | 例子 |
|------|------|------|
| **MoonTide 协议** | 内核 domain 类型 | `ContentBlock`, `ModelRequest` |
| **AdapterFamily** | wire 协议族 | `OpenAiChatCompletions`, `AnthropicMessages` |
| **Preset** | 厂商接入配置 | `deepseek`, `openrouter`, `custom` |

多 preset 可共用同一 AdapterFamily：

```text
preset "deepseek"   × OpenAiChatCompletions → https://api.deepseek.com/chat/completions
preset "deepseek"   × AnthropicMessages     → https://api.deepseek.com/anthropic
preset "openrouter" × OpenAiChatCompletions → https://openrouter.ai/api/v1
```

---

## 5. 调用链（出站 / 入站）

```text
出站:
  ModelRequest
    → normalize::common::validate_request
    → normalize::{family}::encode_request      # 语义 → wire 中间表示
    → adapter::{family}::post_stream(body)     # HTTP + SSE

入站:
  raw SSE event
    → adapter::{family}::parse_raw_event
    → normalize::{family}::decode_delta         # wire → StreamDelta
    → (可选) normalize::common::...
    → loop 消费 StreamDelta
```

**分工：** adapter 不做 tool/thinking 语义互转；normalize 不发 HTTP。

---

## 6. 公开类型（`protocol/`）

### 6.1 消息

```rust
enum Role {
    User,
    Assistant,
}

enum ContentBlock {
    Text { text: String },
    Thinking { thinking: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    ToolResult { tool_use_id: String, content: ToolResultContent },
}

enum ToolResultContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

struct Message {
    role: Role,
    content: MessageContent,
}

struct ToolSchema {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}
```

### 6.2 请求 / 响应

```rust
enum ThinkingLevel {
    Off,
    Low,
    Medium,
    High,
}

struct ModelRequest {
    model: String,
    system: String,
    messages: Vec<Message>,
    tools: Vec<ToolSchema>,
    max_tokens: u32,
    thinking_level: Option<ThinkingLevel>,
    session_id: Option<String>,   // 供 local daemon prefix cache；cloud 可忽略
}

enum StopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
    Other(String),
}

struct Usage {
    input_tokens: u32,
    output_tokens: u32,
}

struct ModelResponse {
    content: Vec<ContentBlock>,
    stop_reason: StopReason,
    usage: Option<Usage>,
    model: Option<String>,
}
```

### 6.3 流式增量

```rust
enum StreamDelta {
    TextDelta { text: String },
    ThinkingDelta { thinking: String },
    ToolUseStart { id: String, name: String },
    ToolUseDelta { id: String, input_json_delta: String },
    ToolUseEnd { id: String },
    MessageEnd {
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
}
```

### 6.4 错误（与取消正交）

```rust
enum CancelReason {
    User,
    Parent,
    Hook,
    Disposed,
}

enum RequestFailureKind {
    Recoverable,
    Unrecoverable,
}

enum LlmError {
    Cancelled { reason: CancelReason },
    RequestFailed { kind: RequestFailureKind, message: String },
}
```

---

## 7. 端口（`provider.rs`）

```rust
trait LLMProvider: Send + Sync {
    /// 流式调用。成功路径必须以恰好一个 `MessageEnd` 结束，且为最后一项。
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<StreamDelta, LlmError>> + Send + '_>>;
}

/// 便利：将 stream 收成 `ModelResponse`（测试 / 非流式调用方）。
async fn complete(
    provider: &dyn LLMProvider,
    request: ModelRequest,
) -> Result<ModelResponse, LlmError>;
```

首版不在 trait 上暴露 `count_tokens`；需要时作为 `LLMProvider` 扩展方法或独立端口后置。

---

## 8. Adapter 层（`adapter/`）

```rust
enum AdapterFamily {
    OpenAiChatCompletions,
    AnthropicMessages,
    // OpenAiResponses,   // 后置（Codex 场景）
    // GoogleGenerateContent,
}

struct AdapterConfig {
    base_url: String,
    api_key: String,
}

/// 工厂：由 agent 组合根调用；loop 不 import。
fn build_provider(
    family: AdapterFamily,
    config: AdapterConfig,
) -> Box<dyn LLMProvider>;
```

---

## 9. Normalize 层（`normalize/`）

### 9.1 组织规则（family 一级 + 族内 concern）

- **一级目录：** 每个 `AdapterFamily` 对应 `normalize/{family}/`（与 `adapter/{family}/` 1:1）。
- **族内拆分：** `tool.rs` / `thinking.rs` / `stream.rs`（OpenAI Chat 族重点实现）。
- **跨族共用：** `common.rs`（handoff 清洗、request 校验）；禁止把族特有语义塞进 common。

### 9.2 新增 AdapterFamily checklist

```text
☐ AdapterFamily enum 加变体
☐ adapter/{family}/ 实现 LLMProvider
☐ normalize/{family}/ 实现 encode/decode（允许 pass-through，但目录必须存在）
☐ build_provider 注册
☐ 单测：tool round-trip 或 stream → MessageEnd 不变量
```

### 9.3 族内入口（示意）

```rust
// normalize/openai_chat/mod.rs
fn encode_request(request: &ModelRequest) -> OpenAiChatRequestBody;
fn decode_stream_event(raw: &RawSseEvent) -> Option<StreamDelta>;

// normalize/anthropic_messages/mod.rs — 首版多数 identity / 薄封装
fn encode_request(request: &ModelRequest) -> AnthropicMessagesBody;
fn decode_stream_event(raw: &RawSseEvent) -> Option<StreamDelta>;
```

---

## 10. Preset（`agent/preset/`，不在 llm mod）

```rust
struct Preset {
    id: String,
    adapter_family: AdapterFamily,
    base_url: String,
    api_key_env: String,
}

fn resolve_provider(preset_id: &str) -> Box<dyn LLMProvider>;
```

**首版默认：** preset `deepseek` · `AdapterFamily::OpenAiChatCompletions` · `base_url = https://api.deepseek.com`。

---

## 11. 不变量

1. **`stream` 成功路径：** 增量任意顺序，但 **恰好一个** `MessageEnd`，且为最后一项。
2. **Tool 流：** 每个 `id` 满足 `ToolUseStart` → 零或多 `ToolUseDelta` → `ToolUseEnd`；禁止无 Start 的 Delta/End。
3. **`ModelRequest.messages`：** 不得为空；`system` 允许空串。
4. **取消：** 走 `LlmError::Cancelled`；不通过成功 `MessageEnd` + `StopReason` 表达取消。
5. **依赖：** `normalize` 不 import `adapter`；`protocol` 不 import 本 mod 其他子模块以外的 IO crate。

---

## 12. 边界情况

| 场景 | 处理层 | 策略 |
|------|--------|------|
| 换 preset / handoff 后 history 含目标族不支持的 block | `normalize::common` | 清洗或 strip，不 panic |
| OpenAI 形 `tool_calls.arguments` 分片流 | `normalize/openai_chat/stream` | 合并后再 `ToolUseEnd` |
| DeepSeek thinking → `reasoning_content` | `normalize/openai_chat/thinking` | 映射为 `ThinkingDelta` / block |
| Anthropic 形与 MoonTide 同构 | `normalize/anthropic_messages` | 多数 pass-through |
| HTTP 4xx/5xx / 断流 | `adapter` | 映射为 `LlmError::RequestFailed` |
| 用户 abort in-flight | `loop` + provider | `LlmError::Cancelled { reason: User }` |

---

## 13. 决策记录

1. **MoonTide 协议 = block 模型**（非绑 Anthropic 云）：与 agent loop / session log 语义对齐；厂商差异关在 adapter + normalize。
2. **Adapter 按协议族、Preset 按厂商：** 多 endpoint / 多厂商复用同一 adapter 族；加厂商改 preset 表或 config，不改 protocol。
3. **Normalize 混合结构：** family 一级目录（与 adapter 配对）+ 族内 tool/thinking/stream；跨族逻辑仅放 `common.rs`。
4. **首版默认 wire：** DeepSeek preset 使用 `OpenAiChatCompletions`（`https://api.deepseek.com/chat/completions`）；`AnthropicMessages` enum 与 normalize 骨架同步预留。
5. **trait 纪律：** 本 mod 对外 trait 仅 `LLMProvider`；normalize 用纯函数 + mod，不上 trait。

---

## 14. 首版实现范围

| 交付 | 首版 | 后置 |
|------|------|------|
| `protocol/` 全套类型 | ✓ | — |
| `LLMProvider` + `complete()` | ✓ | — |
| `normalize/common` + `openai_chat/{tool,thinking,stream}` | ✓ | — |
| `normalize/anthropic_messages` | 骨架 / pass-through | 完整实现 |
| `adapter/openai_chat`（DeepSeek） | ✓ | — |
| `adapter/anthropic_messages` | stub | — |
| `agent/preset` deepseek 默认 | 随 agent 模块 | llm 单测用 `MockProvider` |
| Responses / Gemini 族 | — | 有需求再加 |

---

## 15. 单测方向（实现阶段）

- `MockProvider`：可控 `StreamDelta` 序列，验证 loop 侧消费契约。
- `normalize/openai_chat/tool`：MoonTide blocks ↔ OpenAI messages round-trip。
- `stream` 不变量：Tool 序列、`MessageEnd` 唯一性。
- `build_provider`：注册表覆盖已声明的 `AdapterFamily`（stub 也算）。
