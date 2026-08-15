# llm

> **职责：** 定义 MoonTide 模型调用契约（协议类型 + `LLMProvider` 端口），并通过 adapter / normalize 与厂商 wire 协议解耦。
> **状态：** 流式消费修订已完成（R5–R6）；48 tests。
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
    stream_event.rs         # ModelStreamEvent（adapter 产出；loop 禁止直接 fold）
    snapshot.rs             # ModelResponseSnapshot, PendingBlock
    error.rs                # LlmError, CancelReason, RequestFailureKind
  response_builder.rs       # ModelResponseBuilder（delta → Snapshot / Response，唯一 fold）
  provider.rs               # trait LLMProvider + run_model_call（loop 入口）
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
    └── llm::protocol + llm::run_model_call[_with_updates]
    └── （禁止）直接 match ModelStreamEvent / 自行 fold

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
| `LLMProvider` | `stream(ModelRequest)` → `ModelStreamEvent` | 路由、重试、session 写入 |
| `run_model_call` | `ModelResponse` | 直接消费 `ModelStreamEvent` |
| `ModelResponseBuilder` | `Snapshot` / `ModelResponse` | 第二套 fold 实现 |
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
    → normalize::{family}::StreamDecoder        # wire → ModelStreamEvent
    → ModelResponseBuilder::apply               # 唯一 fold（llm crate 内）
    → ModelResponseSnapshot（流式）/ ModelResponse（结束）
    → loop 经 run_model_call*；RunEvent 转发 snapshot / response
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

### 6.3 流式事件（`ModelStreamEvent`）

adapter / normalize 产出；**loop 禁止直接 fold**。与 `RunEvent` 区分：此为单次 LLM 调用内的流事件。

```rust
enum ModelStreamEvent {
    TextPart { block_index: u32, text: String },
    ThinkingPart { block_index: u32, thinking: String },
    ToolUseStarted { id: String, name: String },
    ToolUsePart { id: String, input_json: String },   // 流式预览；累积在 normalize
    ToolUseFinished { id: String, name: String, input: serde_json::Value },
    Finished {
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
}
```

**`block_index`：** 同一 assistant 消息内 content 块序号；index 变化时 `ModelResponseBuilder` flush 上一块。OpenAI Chat 族首版可恒为 `0`；Anthropic 形 API 映射真实 index。

**刻意不在此枚举：** `ResponseStarted`（归 loop / `RunEvent::message_start`）、全文 `ResponseCompleted`（归 `ModelResponseBuilder::finish()`）。

### 6.4 快照与 fold（`snapshot.rs` + `response_builder.rs`）

```rust
enum PendingBlock {
    Text { text: String },
    Thinking { thinking: String },
    ToolUse { id: String, name: String, input_json: String },
}

struct ModelResponseSnapshot {
    content: Vec<ContentBlock>,       // 已 flush
    pending: Option<PendingBlock>,    // 进行中（UI / message_update 用）
    stop_reason: Option<StopReason>,
    usage: Option<Usage>,
    model: Option<String>,
}

struct ModelResponseBuilder { /* ... */ }

impl ModelResponseBuilder {
    fn new(model: impl Into<String>) -> Self;
    fn apply(&mut self, event: ModelStreamEvent) -> Result<ModelResponseSnapshot, LlmError>;
    fn snapshot(&self) -> ModelResponseSnapshot;
    fn finish(self) -> Result<ModelResponse, LlmError>;
}
```

**fold 规则：** `block_index` 或 part 类型（Text vs Thinking）变化 → flush；`ToolUseStarted` → flush 文本/思考；`ToolUseFinished` → push `ContentBlock::ToolUse`；`Finished` → flush + 记录元数据。

### 6.5 错误（与取消正交）

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

### 7.1 `LLMProvider`（adapter 实现）

```rust
trait LLMProvider: Send + Sync {
    /// 低层流。成功路径必须以恰好一个 `Finished` 结束，且为最后一项。
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>>;
}
```

### 7.2 loop 入口（**首选**；不直接消费 `ModelStreamEvent`）

```rust
/// 无流式 UI：await 即得完整 `ModelResponse`。
async fn run_model_call(
    provider: &dyn LLMProvider,
    request: ModelRequest,
) -> Result<ModelResponse, LlmError>;

/// 有流式 UI：内部 `ModelResponseBuilder` fold；每 apply 一次可选通知 `on_update(snapshot)`。
/// loop 只传闭包刷新界面，不 match 事件、不拼 JSON。
async fn run_model_call_with_updates<F>(
    provider: &dyn LLMProvider,
    request: ModelRequest,
    on_update: F,
) -> Result<ModelResponse, LlmError>
where
    F: FnMut(ModelResponseSnapshot);

/// `complete` = `run_model_call` 别名（测试兼容）。
async fn complete(...) -> Result<ModelResponse, LlmError>;
```

**与 `RunEvent` 接缝（`event` mod，后置）：** loop 在 `run_model_call_with_updates` 闭包内 `publish(message_update { snapshot })`；结束后 `publish(message_end { response })`。`message_start` 在调 `run_model_call*` 之前由 loop 发。

### 7.3 Snapshot 供给 vs 渲染决策

| 半边 | 负责方 | 契约 |
|------|--------|------|
| **供给** | `llm`（`run_model_call_with_updates`） | 每次 `ModelResponseBuilder::apply` 后调用 `on_update(snapshot)`；`snapshot` 含 `content` + `pending`（`ContentBlock` 语义，非裸事件） |
| **渲染** | REPL / `cli` | 是否重绘、节流、展示 tool 参数或仅 spinner，由 UI 自定；`llm` 不做帧率控制 |

`run_model_call`（无回调）仍内部 fold，只交付最终 `ModelResponse`；有流式 UI 时必须走 `run_model_call_with_updates`（或后置 `Stream<Snapshot>`）。

### 7.4 REPL 渲染契约

- **只依赖** `ModelResponseSnapshot` / `ContentBlock`；**禁止** match `ModelStreamEvent`、拼 tool JSON。
- Markdown / code：首版走 `ContentBlock::Text`，展示层解析；后置可加 `Code` / `Image` / `File` 变体，仍从 snapshot 取。
- Tool 流式：`pending::ToolUse` 可供 UI 显示「调用中」；完成后 `content` 含已解析 `ToolUse { input: Value }`。
- Session 落盘：仅 `finish()` 后的 `ModelResponse.content`，不写 `pending`。

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
// 出站：normalize 族入口仅 encode。入站解码由 adapter 持有有状态
// `StreamDecoder` + `decode_sse_payload` 完成，不走 normalize 无状态入口——
// 无状态单 chunk 解码无法合并跨 chunk 的 `tool_calls` 分片。

// normalize/openai_chat/mod.rs
fn encode_request(request: &ModelRequest) -> OpenAiChatRequestBody;

// normalize/anthropic_messages/mod.rs — 首版 identity / 薄封装
fn encode_request(request: &ModelRequest) -> AnthropicMessagesBody;
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

1. **`stream` 成功路径：** **恰好一个** `Finished`，且为最后一项。
2. **Tool 流：** 每个 `id` 满足 `ToolUseStarted` → 零或多 `ToolUsePart` → 恰好一个 `ToolUseFinished { input }`；`input` 为 normalize 解析后的 JSON。
3. **`block_index`：** 同一 index 内 part 类型一致（Text 或 Thinking）；index 递增；tool 块不占 text/thinking index。
4. **fold 唯一性：** `ModelResponseBuilder` 为 `ModelStreamEvent` → `ModelResponse` 的唯一实现；`loop` 禁止第二套 fold。
5. **`ModelRequest.messages`：** 不得为空；`system` 允许空串。
6. **取消：** 走 `LlmError::Cancelled`；不通过 `Finished` 表达取消。
7. **依赖：** `normalize` 不 import `adapter`；`protocol` 不 import 本 mod 其他子模块以外的 IO crate。

---

## 12. 边界情况

| 场景 | 处理层 | 策略 |
|------|--------|------|
| 换 preset / handoff 后 history 含目标族不支持的 block | `normalize::common` | 清洗或 strip，不 panic |
| OpenAI 形 `tool_calls.arguments` 分片流 | `normalize/openai_chat/stream` | 合并后 `ToolUseFinished { input }` |
| DeepSeek thinking → `reasoning_content` | `normalize/openai_chat/thinking` | 映射为 `ThinkingPart` / block |
| Anthropic 形与 MoonTide 同构 | `normalize/anthropic_messages` | 多数 pass-through |
| HTTP 4xx/5xx / 断流 | `adapter` | 映射为 `LlmError::RequestFailed` |
| OpenAI 流是否结束 | `normalize/openai_chat/stream` | `finish_reason` → `Finished`；`data: [DONE]` 仅跳过，不作收束依据 |
| 用户 abort in-flight | `loop` + provider | `LlmError::Cancelled { reason: User }` |

---

## 13. 决策记录

1. **MoonTide 协议 = block 模型**（非绑 Anthropic 云）：与 agent loop / session log 语义对齐；厂商差异关在 adapter + normalize。
2. **Adapter 按协议族、Preset 按厂商：** 多 endpoint / 多厂商复用同一 adapter 族；加厂商改 preset 表或 config，不改 protocol。
3. **Normalize 混合结构：** family 一级目录（与 adapter 配对）+ 族内 tool/thinking/stream；跨族逻辑仅放 `common.rs`。
4. **首版默认 wire：** DeepSeek preset 使用 `OpenAiChatCompletions`（`https://api.deepseek.com/chat/completions`）；`AnthropicMessages` enum 与 normalize 骨架同步预留。
5. **trait 纪律：** 本 mod 对外 trait 仅 `LLMProvider`；normalize 用纯函数 + mod，不上 trait。
6. **流式消费（2026-08-15）：** `ModelStreamEvent` + `block_index`；fold 只在 `ModelResponseBuilder`；loop 经 `run_model_call*`；不学 Pi 每条 `partial`；不在 adapter 枚举里放 `ResponseStarted` / 全文 `ResponseCompleted`。
7. **命名：** `StreamDelta` / `MessageEnd` 等旧名废弃，统一 `ModelStreamEvent` / `Finished` / `*Part`。

---

## 14. 实现范围

| 交付 | R1（已完成） | R2（流式消费修订） |
|------|-------------|-------------------|
| `protocol/` 消息 + 请求类型 | ✓ | — |
| `ModelStreamEvent` + `block_index` | ✓ | — |
| `ModelResponseSnapshot` + `ModelResponseBuilder` | ✓ | — |
| `run_model_call` / `run_model_call_with_updates` | ✓ | — |
| `LLMProvider` + adapter / normalize | ✓ | — |
| `agent/preset` deepseek 默认 | 随 agent 模块 | — |
| Responses / Gemini 族 | — | 后置 |

---

## 15. 单测方向

- `ModelResponseBuilder`：`block_index` 交错、`ToolUseFinished`、与 `Finished` 收束。
- `run_model_call_with_updates`：闭包收到单调增长的 `snapshot.pending` / `content`。
- `normalize/openai_chat/stream`：`ToolUseFinished.input` 由分片正确合并。
- `MockProvider`：可控 `ModelStreamEvent` 序列。
- `build_provider`：注册表覆盖已声明的 `AdapterFamily`（stub 也算）。
