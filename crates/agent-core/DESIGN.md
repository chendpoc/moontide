# agent-core — 技术设计

> **读者：** 实现者、代码审查。
> **状态：** 模块 1–7 已实现；`scheduler` 后置。
> **分工：** 本文是 `agent-core` crate 内 8 模块的实现权威。跨 crate 分层、依赖图与不变量摘要见 [`crates/docs/agent-core.md`](../docs/agent-core.md)；模块进度见 [`README.md`](README.md)。
> **模块 README：** 各 `src/{mod}/README.md` 为短集成说明，链接回本文对应锚点。

---

<a id="llm"></a>

## llm

## 1. 职责与边界

内核唯一的 LLM 边界：`loop` / `context` / `session` 只依赖 **MoonTide 协议类型** 与 **`LLMProvider` trait**；HTTP、厂商 JSON/SSE、endpoint 关在 `adapter/` + `normalize/`，由 `agent` 组合根注入。

**不在本 mod：** concrete provider/model catalog、provider defaults、credential env registry、
API key 解析，以及 CLI/Desktop settings schema/IO。catalog 与 provider-scoped merge 属于
`agent::llm`；settings schema/IO 属于各 host。

---

## 2. 模块结构

```text
llm/
  README.md                 # 对外使用说明
  DESIGN.md                 # 本文
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
    └── llm::adapter::build_provider(AdapterConfig)

llm::adapter/{family}
    └── protocol + normalize::{family} + reqwest

llm::normalize/{family}
    └── protocol + normalize::common
```

| 层 | 知道什么 | 禁止 |
|----|----------|------|
| `protocol` | MoonTide 类型 | HTTP、SDK、base_url、preset |
| `LLMProvider` | `stream` → `ModelStreamEvent` | 路由、重试、Turn cancellation policy、session 写入 |
| `run_model_call` | `ModelResponse` | 直接消费 `ModelStreamEvent` |
| `ModelResponseBuilder` | Snapshot / Response | 第二套 fold |
| `normalize` | 跨 wire 语义等价 | HTTP、vendor 名 |
| `adapter` | wire serde + SSE | loop、权限、tool 执行 |

---

## 4. 三个概念

| 概念 | 含义 | 例子 |
|------|------|------|
| **MoonTide 协议** | 内核 domain 类型 | `ContentBlock`, `ModelRequest`, `ThinkingLevel` |
| **AdapterFamily** | wire 协议族 | `OpenAiChatCompletions`, `OpenAiResponses`, `AnthropicMessages` |
| **Adapter option** | 组合根已解析的显式 wire 选择 | `OpenAiThinkingExtension::ChatTemplateKwargs` |
| **`LlmCallConfig`** | 单次 LLM 调用 config（L3） | protocol + endpoint + generation；`TurnInput.config` |
| **`ProviderProtocolProfile`** | `(provider, protocol)` 连续性与 wire 能力 | 在 `agent::llm` catalog；随 `LlmCallConfig.profile` 进入 adapter |

```text
agent::llm catalog → ResolvedProviderConfig
  → AdapterFamily + AdapterConfig + adapter-specific options
  → agent-core::llm::build_provider
```

Wire 字段差异（thinking 出站、tool 形状、SSE delta）由 `normalize/{family}/` 从
canonical `ModelRequest` 与 adapter-specific options 映射。normalize 不读取
`ProviderId`，也不从 model id 前缀推断 vendor。

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

**fold 规则：** `block_index` 或 Text/Thinking 类型变化 → flush；ToolUse 按 `id` 维护多个并行 open block，`ToolUseFinished` 先标记完成，再按 `ToolUseStarted` 顺序 flush 为 `ContentBlock::ToolUse`；`Finished` → flush + 元数据。`pending` 在并行 ToolUse 时暴露第一个尚未完成的调用。

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

**与 `TurnEvent`：** loop 在 `on_update` 内 emit `MessageUpdate`；调用前 `LlmCallStarted`，结束后 `LlmCallEnded` + `AssistantFinalized`（event 模块）。

### Loop R1 retry / cancellation

`llm` 只分类错误，不拥有重试政策。loop 对一个 Step 只 materialize/compile 一次，再以同一 `ModelRequest` 发起多个 attempt：

```text
attempt 0
  └─ Recoverable → 500 ms
attempt 1
  └─ Recoverable → 1 s
attempt 2
  └─ Recoverable → 2 s
attempt 3
```

- 默认 `max_llm_retries = 3`，总 attempt 上限 4；
- 仅 `RequestFailed { Recoverable }` 重试；
- 每个 attempt 使用新的 `llm_call_id`，但 Step 不变；
- retry 不重新 compile，也不写 Session；
- exhausted 返回最后一个原始 LlmError；
- Turn cancellation 由 loop 用 `CancellationToken` select LLM future 与 backoff；
- provider `Cancelled` 不重试；
- final response commit 后晚到 cancellation 不覆盖成功。

`CancellationToken` 不进入 `LLMProvider` trait，避免把 Turn owner 泄漏进 provider port；provider 仍可用现有 `LlmError::Cancelled` 表达自身取消。

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
    OpenAiResponses,
    AnthropicMessages,
}

enum AdapterConfig {
    OpenAiChat {
        base_url: String,
        api_key: String,
        options: OpenAiChatOptions,
    },
    OpenAiResponses {
        base_url: String,
        api_key: String,
        options: OpenAiResponsesOptions,
    },
    AnthropicMessages {
        base_url: String,
        api_key: String,
        options: AnthropicMessagesOptions,
    },
}

fn build_provider(config: AdapterConfig) -> Result<Box<dyn LLMProvider>, LlmError>;
```

family-specific enum variants make a family/config mismatch unrepresentable. Encode 按
`ProviderProtocolProfile` 在 **Canonical**（全量 materialize）与 **Optimized**（如 OpenAI
`previous_response_id`）之间选择；profile 来自 catalog，adapter 不读 `ProviderId`。

### 8.1 `LlmCallConfig`（替换 `ModelRequestConfig`）

```rust
struct LlmCallConfig {
    protocol: AdapterFamily,
    profile: ProviderProtocolProfile,
    model: String,
    base_url: String,
    api_key: String,
    options: AdapterOptions,
    max_tokens: u32,
    thinking_level: Option<ThinkingLevel>,
    session_id: Option<String>,
    continuity_hint: ContinuityHint,
}

enum ContinuityHint {
    None,
    PreviousResponseId(String),
}
```

`model_input::compile(&LlmCallConfig, …)` → `ModelRequest`（仍不含 secret）。Session Item Log
是 resume 唯一事实源；`response_id` sidecar 非 model-visible，丢失时降级 Canonical。

---

## 9. Normalize

- 一级目录与 `AdapterFamily` 1:1（OpenAI map / Anthropic map）
- 族内：`tool.rs` / `thinking.rs` / `stream.rs`
- 跨族：`common.rs`（validate、handoff 清洗）
- 入站解码：`StreamDecoder` 有状态，在 adapter 内；encode 走无状态 `encode_request(&ModelRequest)`
- **thinking：** 出站读 `ModelRequest.thinking_level` + `OpenAiChatOptions` 中的显式
  `OpenAiThinkingExtension`；入站 `reasoning_content` → `ThinkingPart`。normalize 不读
  `ProviderId`，也不检查 `agnes-*` model 前缀。

### 新增 AdapterFamily checklist

```text
☐ AdapterFamily enum
☐ adapter/{family}/ 实现 LLMProvider
☐ normalize/{family}/ encode + decode
☐ build_provider 注册
☐ 单测：tool round-trip 或 stream → Finished
```

---

## 10. Provider catalog 与 resolved config 边界

concrete `ProviderId`、`ProviderEntry`（含 **`default_protocol`**、**`protocol_profiles`**）、
model/default endpoint、credential env 名和 adapter option mapping 属于 `agent::llm::catalog`，
不进入 `agent-core`。

`ProviderProtocolProfile` 在 catalog 为每个 `(provider, protocol)` 声明连续性（
`ClientMaterialize` / `OptionalServerResponseChain`）、Responses 能力位与 wire quirks。
merge 后进入 `ResolvedProviderConfig.profile` 与 `LlmCallConfig.profile`。

`agent-core::llm` 只公开 provider-neutral 的 `AdapterFamily`、`AdapterConfig`、
`LlmCallConfig`、`ProviderProtocolProfile` 与 adapter-specific option。CLI/Desktop 只向
`agent::llm` 提交 `LlmConfigLayer`（含可选 `protocol`）；`agent::llm` 产出
`ResolvedProviderConfig`，再由 bootstrap 转换为 `AdapterConfig`。

完整 Feature 见 [`crates/docs/features/LLM-FOUR-AXIS.md`](../docs/features/LLM-FOUR-AXIS.md)；
历史 provider-config 修复见 [`llm-provider-config-fix.md`](../docs/archive/plans/llm-provider-config-fix.md)。

---

## 11. 不变量

1. 成功 `stream`：**恰好一个** `Finished`，且为最后一项
2. Tool 流：每个 `id` 满足 `ToolUseStarted` → `ToolUsePart*` → `ToolUseFinished { input }`；多个 id 可交错并行
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
| OpenAI 多个并行 tool calls | `openai_chat/stream` + `response_builder` | 按 index/id 收束并保持 provider 顺序 |
| OpenAI-compatible thinking | `openai_chat/thinking` | 入站 `ThinkingPart`；出站按显式 `OpenAiThinkingExtension` 选择扩展字段 |
| HTTP 4xx/5xx | `adapter` | `RequestFailed` |
| 用户 abort | `loop` + provider | `Cancelled { User }` |

---

## 13. 决策记录

1. MoonTide 协议 = block 模型；厂商差异在 adapter + normalize
2. Adapter 按协议族；concrete catalog 属于 `agent::llm`；wire encoding 按 normalize 族与显式 adapter option
3. Normalize：family 一级 + 族内 concern；common 仅跨族
4. 首版 DeepSeek × `OpenAiChatCompletions`
5. 对外 trait 仅 `LLMProvider`
6. 流式：`ModelStreamEvent` + Builder；loop 经 `run_model_call*`
7. 旧名废弃：`StreamDelta` / `MessageEnd` → `ModelStreamEvent` / `Finished`
8. `Message` canonical record 与 provider wire payload 分离；完整转换由 adapter 持有，不由 context 或 protocol 类型持有
9. LLM retry 属于 loop 的 Step policy；Provider 只返回可恢复/不可恢复分类
10. Turn cancellation 直接在 loop select `CancellationToken`，不扩大 LLMProvider 签名

---

## 14. 实现范围

| 交付 | 状态 |
|------|------|
| `protocol/` + `LLMProvider` | ✓ R1 |
| normalize / adapter 层（Chat + Anthropic stub） | ✓ R2–R3 |
| 不变量单测 | ✓ R4 |
| `ModelStreamEvent` + Builder + `run_model_call*` | ✓ R5–R6 |
| provider-neutral adapter options；catalog 外移至 `agent::llm` | ✓ R8 |
| **四轴解耦 + Responses + 真实 Anthropic + `LlmCallConfig`** | Feature 对齐；R1–R4 待实现 |

---

## 15. 单测方向

- `ModelResponseBuilder`：`block_index` 交错、`ToolUseFinished`、`Finished` 收束
- `run_model_call_with_updates`：闭包收到单调 `snapshot`
- `normalize/openai_chat/stream`：分片合并 `input`
- `MockProvider`：可控事件序列
- `build_provider`：注册表覆盖各 `AdapterFamily`

---

<a id="session"></a>

## session

## 1. 职责与边界

维护 **Session Item Log**（append-only 事实源）与外置 **SessionHeader**。

| 做 | 不做 |
|----|------|
| create/load/append/fork/items | materialize（context） |
| id/seq/at 分配与恢复校验 | Turn/Step 状态机（loop） |
| TurnEvent → SessionItem mapping | EventDispatcher / Hook |
| next turn cursor 计算 | 跨实例 Session lease |

**唯一物理写盘入口：** `SessionStore::commit_item`。生产调用链必须是 `loop emit → SessionStore CommitHandler → commit_from_event → commit_item`。

SessionStore 是 AgentLoop 的 non-Clone、独占运行时状态。R1 不用 `Arc<Mutex<_>>`，也不为尚不存在的第二 writer 建立 OS lock。

---

## 2. 持久化布局

```text
{sessions_dir}/
└── {YYYY-MM-DD}/
    ├── {session_id}.meta.json    # SessionHeader
    └── {session_id}.log.jsonl    # 一行 JSON = 一个 SessionItem
```

- `sessions_dir` 由 agent/cli 注入；session 不读 env；
- 新建 session 写入本地日期分区 `{YYYY-MM-DD}/`；`load` 在该根目录下扫描日期子目录定位 `{session_id}`；
- `session_id` 是 UUID；create/load 校验以防路径逃逸；
- R1 全量 load 进内存，大 log 流式迭代后置；
- header 不进入 Session Item Log。

---

## 3. 模块结构（目标）

```text
session/
  README.md
  DESIGN.md
  mod.rs
  types.rs
  store.rs
  file_store.rs
  commit.rs            # commit_from_event + CommitHandler impl
  tests.rs
```

Loop 接缝批删除 `commit_handler.rs` 的 Mutex wrapper。若为迁移短期保留文件，最终公开 API 仍不得暴露 `SessionCommitHandler`。

---

## 4. 类型

### 4.1 `SessionItemBase`

```rust
pub struct SessionItemBase {
    pub id: String,
    pub seq: u64,
    pub session_id: String,
    pub turn: u64,
    pub at: String,
}
```

一行 JSONL = 一个 SessionItem，无 LogEnvelope。

### 4.2 `SessionItem`

```rust
pub enum SessionItem {
    UserMessage {
        base: SessionItemBase,
        text: String,
    },
    AssistantMessage {
        base: SessionItemBase,
        blocks: Vec<ContentBlock>,
    },
    ToolCall {
        base: SessionItemBase,
        call: ToolCall,
    },
    ToolResult {
        base: SessionItemBase,
        result: ToolResult,
    },
    Compaction { /* current fields */ },
    CheckpointCreated { /* current fields */ },
}
```

AssistantMessage 只允许 Text/Thinking；ToolUse/ToolResult 分别持久化为独立 tool items。Session 不解释 `ToolResultStatus`，只验证 identity 并持久化 canonical payload。

当前 header version 是 v2：新行使用 `tool_call` / `tool_result`，ToolContent 带 `{ type, value }` tag。v1 legacy kind 可读取；缺失 status → OutcomeUnknown，string content → Text，其他 JSON → Json。加载 v1 后 append 新行不重写旧行；fork 产生纯 v2 child；未知 version 拒绝。

### 4.3 `SessionHeader`

```rust
pub struct SessionHeader {
    pub version: u32,
    pub session_id: String,
    pub cwd: PathBuf,
    pub parent_session: Option<String>,
    pub seed_len: u64,
}
```

### 4.4 `SessionItemDraft`

Draft 只有 `turn` + payload，不含 id/seq/session_id/at。由 store 校验后冻结。

### 4.5 `SessionStore`

```rust
pub struct SessionStore {
    header: SessionHeader,
    items: Vec<SessionItem>,
    next_seq: u64,
    store: FileSessionStore,
}

impl SessionStore {
    pub fn create(
        sessions_dir: impl AsRef<Path>,
        cwd: PathBuf,
    ) -> anyhow::Result<Self>;

    pub fn load(
        sessions_dir: impl AsRef<Path>,
        session_id: &str,
    ) -> anyhow::Result<Self>;

    pub fn commit_item(
        &mut self,
        draft: SessionItemDraft,
    ) -> anyhow::Result<&SessionItem>;

    pub fn fork(
        &self,
        sessions_dir: impl AsRef<Path>,
        boundary_item_id: &str,
    ) -> anyhow::Result<Self>;

    pub fn items(&self) -> &[SessionItem];
    pub fn header(&self) -> &SessionHeader;

    pub(crate) fn next_turn(&self) -> anyhow::Result<u64>;
}
```

SessionStore 不实现 Clone。`fork` 是领域操作，创建新 identity/log，不是 Rust 句柄复制。

### 4.6 Event commit seam

```rust
pub fn commit_from_event<'a>(
    store: &'a mut SessionStore,
    event: &TurnEvent,
) -> anyhow::Result<&'a SessionItem>;

impl crate::event::CommitHandler for SessionStore {
    fn commit(
        &mut self,
        event: &TurnEvent,
    ) -> anyhow::Result<Option<String>>;
}
```

mapping：

| TurnEvent | SessionItem |
|-----------|-------------|
| UserPromptCommitted | UserMessage |
| AssistantFinalized | AssistantMessage |
| ToolCallRecorded | ToolCall |
| ToolResultRecorded | ToolResult |
| CompactionApplied | Compaction |

非 Committable event 返回错误；EventDispatcher 不应对它调用 commit。

`CommitHandler::commit` 在 `commit_from_event` 后复制新 item id 返回，供 TraceContext 的 `session_item_id` correlation 使用。它不持有 store，不需要 Send/Sync 或 Mutex。

---

## 5. `commit_item` 算法

```text
commit_item(draft):
  1. validate_draft
  2. assign id = uuid
  3. assign seq = next_seq with checked increment
  4. assign at = now
  5. freeze SessionItem and serialize
  6. append file
  7. push items + advance next_seq
  8. return last item
```

实现必须保证 append 失败不让内存声称成功。当前实现的具体“先内存再文件并回滚”或“先文件再内存”顺序以已通过测试的代码为准；Loop 接缝批不得改变其原子性。

---

## 6. `next_turn` 与 Turn 消费点

```text
next_turn():
  items.last()
    None       → 0
    Some(item) → item.base.turn.checked_add(1)
```

不变量：

1. 只读，不修改 cursor 或文件；
2. empty session → 0；
3. checked overflow → Err；
4. caller 不能传 turn number；
5. `UserPromptCommitted` commit 成功才消费编号；
6. commit 后的 Turn 失败不回滚、不复用编号；
7. 下一 Turn 仍由 last item 推导，因此失败 Turn 中后续 facts 保持同一 turn。

新 UserMessage 前，AgentLoop 先对已有 items 调 `context::materialize`。该 preflight 属于 loop；session 不反向 import context。

---

## 7. 与 event / loop 协作

```text
agent create/load/fork SessionStore
    │ move
    ▼
AgentLoop
    │
    ├─ context::materialize(session.items())
    ├─ session.next_turn()
    └─ events.emit(&mut session, TurnEvent)
           │
           ├─ committable → SessionStore::commit
           │                  → commit_from_event → commit_item
           └─ post-commit Hook
```

生产约束：

- loop 持有 SessionStore，但不直接调用 `commit_item`；
- EventDispatcher 只短借 `&mut dyn CommitHandler`；
- session 不持有 EventDispatcher 或 Hook；
- AgentLoop 构造后 agent 不保留第二个 writer。

Resume：`load → validate/replay → items → materialize`，不需要 EventDispatcher。

---

## 8. 单 writer 与不支持的并发

`turn(&mut self)` 保证一个 AgentLoop 实例内 Turn 串行。它不协调：

- 两个 AgentLoop 同时 load 同一个 session；
- 两个进程同时 append 同一 log；
- 外部直接修改 JSONL。

R1 明确把这些视为 unsupported，而不是隐式安全。当前架构没有第二个合法 runtime writer，提前加入 file lock/lease 会引入 owner、过期、崩溃恢复与跨平台语义而没有消费者。

未来只有出现真实并发 writer 后，才评审：lock file、lease identity/TTL、stale recovery、read-only follower 和 fork 协调。

---

## 9. import 边界

```text
session → llm::protocol（ContentBlock）
session → tools（ToolCall / ToolResult）
session → event（TurnEvent + CommitHandler seam）

loop → SessionStore public/crate-private API
context → SessionItem read-only contract
agent → create/load/fork then move

session ↛ loop / context / model_input / agent / cli
```

session 对 event 的依赖只限稳定的 TurnEvent/CommitHandler seam；event 不 import SessionStore，因此没有环。

---

## 10. 不变量

1. `seq == items.len()`，从 0 连续；断号拒绝；
2. 先校验再冻结，外部输入错误不 panic；
3. AssistantMessage 不含 tool blocks；
4. header 不进 log；
5. `commit_item` 是唯一物理 append；
6. 生产 loop 只经 TurnEvent commit；
7. 每行 session_id 与 header 一致；
8. 只读取 v1 与当前 version；
9. tool item 直接包装 canonical ToolCall/ToolResult；
10. SessionStore non-Clone，AgentLoop 独占；
11. next_turn 只读且 checked；
12. append 成功后的 turn number 不回滚或复用；
13. EventDispatcher 不长期拥有 store；
14. R1 不宣称跨实例 concurrent writer 安全。

---

## 11. 边界情况

| 场景 | 处理 |
|------|------|
| seq 断号 | load Err |
| JSONL 损坏 | load Err，包含行号 |
| empty log | load 合法，next_turn=0 |
| last turn=u64::MAX | next_turn Err |
| fork boundary 非 Turn 末条 | Err |
| 流式 assistant 未 finalized | 无 SessionItem |
| commit non-committable event | Err |
| 同 session 多 writer | unsupported；可能由 load/seq 校验暴露，但无互斥承诺 |
| Turn 中途失败 | 已有 items 保留，下一 Turn 由最后 item 计算编号 |

---

## 12. `fork`

```text
fork(boundary_item_id):
  1. 定位 boundary，要求该 Turn 的最后一条 item
  2. new session_id，parent_session = source id
  3. 复制 prefix，重新连续 seq
  4. 保留原 item.id，seed_len = prefix length
  5. 写独立 header/log
```

Fork 返回新的 SessionStore 所有权；调用方决定把 source 或 child 移入 AgentLoop，不能把两者误当同一 session 的两个 writer。

---

## 13. 决策记录

1. 一行 JSONL = 一个 SessionItem，无 Envelope；
2. ToolCall/ToolResult 分行，materialize 归 context；
3. seq 表位置，id 表身份；
4. Turn boundary/trace 不进事实源；
5. loop 经 TurnEvent commit，不直接 append；
6. v2 typed tool payload，v1 缺失 status → OutcomeUnknown；
7. SessionStore 由 AgentLoop 独占且 non-Clone；
8. EventDispatcher 每次借 mutable commit，不拥有 store；
9. 删除 Mutex-based SessionCommitHandler；
10. next turn 由最后 item 推导，调用者不传入；
11. UserMessage commit 后编号永久消费，失败不回滚；
12. R1 无 Session lease，跨实例同 session 写入不支持；
13. fork 是新 Session 的领域操作，不是 clone。

---

## 14. 实现分期

| 批 | 范围 | 状态 |
|----|------|------|
| R1 | types + file/store create/load/commit | 已实现 |
| R2 | fork + compaction/checkpoint item | 已实现 |
| R3 | commit_from_event + old SessionCommitHandler | 已实现 |
| R3-F1 | v2 ToolCall/ToolResult + v1 migration | 已实现 |
| Loop R1-B | next_turn + direct CommitHandler impl + remove Mutex wrapper | 已实现 |

---

## 15. 单测方向

- seq 连续、断号/损坏行拒绝；
- Assistant tool blocks 拒绝；
- create/commit/load 往返与 file failure 原子性；
- v2 typed payload、v1 load、unknown version；
- fork boundary/parent/seed/seq；
- empty / resumed / u64::MAX next_turn；
- next_turn 只读且不预占编号；
- SessionStore 直接 CommitHandler mapping 与 returned item id；
- EventDispatcher 连续借用同一 store，registry 不拥有它；
- SessionCommitHandler/Mutex 从目标 API 消失；
- session 不 import loop/context/agent；
- concurrent same-session writer 不被测试错误宣称为支持。

---

<a id="tools"></a>

## tools

## 1. 目标与边界

### 1.1 目标

`tools` 提供模型能力的稳定、可测试、可审计的**单次调用契约**：

1. 用纯 `ToolSpec` 描述模型可见能力；
2. 用 `Tool` 把 spec 与实现绑定；
3. 用不可变 `ToolRegistry` 提供确定性的名称解析和 schema 暴露；
4. 校验一次 `ToolCall` 的输入；
5. 通过唯一 `ToolExecutor` trait 执行真实副作用；
6. 让 executor 直接返回带状态的 `ToolResult`；
7. 为 `model_input`、`loop`、`scheduler` 提供明确接缝。

### 1.2 明确不做

| 不做 | 所属模块 |
|------|----------|
| 允许 / 询问声明与交互 | `agent` 组合根提供 map，`loop` 查表并处理 `Ask` |
| 多调用 fan-out、排队、并行、资源冲突 | `scheduler` |
| Turn cancellation、LLM retry | `loop` |
| tool retry、模型 offload/failover 验收 | 后置 `scheduler` |
| Session Item Log 写入 | `event` commit → `session` |
| Agent Event Log、UI、telemetry | `event` / `cli` |
| ModelRequest 组装 | `model_input` |
| LLM wire 协议和 provider | `llm` |
| sidecar IPC | `agent` / 后置 runtime |

### 1.3 依赖方向

```text
model_input ──────────► tools（读取 ToolSpec）
scheduler ────────────► tools（读取调用/结果契约，调用单次入口）
loop ─────────────────► tools + llm + event
agent-tools ──────────► tools（实现第一方 executor，构造 Tool）
tools ────────────────► serde / serde_json / anyhow / std
```

`tools` 不反向 import `loop`、`scheduler`、`session`、`event`、`llm` 或 `agent-tools`。跨模块转换由上层完成：例如 `model_input` 把 `ToolSpec` 映射为 `llm::protocol::ToolSchema`，`loop` 把 `ToolResult` 映射为 `llm::protocol::ContentBlock::ToolResult` 和 `TurnEvent`。`agent-tools` 是相邻的第一方实现库，不是内核 mod；其 `ToolDefinition` 只保存静态 name 与零参数 build function，`build()` 返回已绑定 spec/executor 的 `Tool`，不复制第二套 runtime registry。

`ToolExecutor` 是 tools 的唯一真实副作用 trait。其他模块是否使用 trait 由边界需要决定：必须有独立实现、动态装配或测试替身时可以使用窄 trait；单实现逻辑和未来可能性不提前抽象。

---

## 2. 模块结构

```text
tools/
  README.md
  DESIGN.md
  mod.rs
  spec.rs          # ToolSpec、模型可见能力声明
  registry.rs      # Tool、ToolRegistry、冻结 snapshot
  call.rs          # ToolCall
  executor.rs      # ToolExecutor trait
  result.rs        # ToolResult、状态与内容
  validate.rs      # 名称与 input schema 校验
  tests.rs
```

文件可以在实现时合并，但职责不能合并成一个“大 Tool trait”或一个拥有所有决策的 registry。

---

## 3. 核心类型

### 3.1 `ToolSpec`

```rust
pub struct ToolSpec {
    // private fields
}

impl ToolSpec {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: serde_json::Value,
    ) -> anyhow::Result<Self>;
    pub fn name(&self) -> &str;
    pub fn description(&self) -> &str;
    pub fn input_schema(&self) -> &serde_json::Value;
}
```

约束：

- `name` 匹配 `^[A-Za-z0-9_-]{1,64}$` 且在 registry 内唯一；
- `description` 是模型可见说明，不承载运行时状态；
- `input_schema` 是纯 JSON Schema 数据，不执行 IO。

R1 只保留 `input_schema`。schema 文档的顶层 JSON 值必须是 object，object 内使用 JSON Schema Draft 2020-12；Draft 合法但当前 provider wire 无法表达的 boolean schema 在注册时拒绝。`ToolSpec` 只保存原始声明，不保存编译器或 validator。`ToolRegistry::new` 冻结注册表时校验并编译 schema，禁止网络或外部 `$ref`，编译结果随 frozen registry 缓存并供后续调用复用。非法 schema 使整个 registry 构造失败，不允许先暴露给模型再延迟报错。R1 使用 `jsonschema` 0.49，关闭 default features 以禁用 HTTP/file resolver；先按 Draft 2020-12 meta-schema 校验文档，再构建可复用 validator。该依赖仍是内部实现细节，支持的 dialect 与无外部解析约束由结构测试守门。`output_schema` 后置到出现明确结构化消费者时再评审，避免在副作用已经发生后新增无法回滚的运行时失败。

tools 中的 name 与 schema 是 canonical、跨当前 provider 可移植的 contract。名称和 schema 顶层 JSON 形状不做 provider 重命名或包装；关键词兼容属于 LLM wire 编码，adapter 默认原样传递 schema，仅在官方行为或真实失败已证明某个关键词不兼容时，增加局部、显式、带测试的转换。即使转换有损，本地仍使用 canonical schema 校验模型返回的 input，并在 permission/executor 前拒绝不匹配值。R1 不抽象通用 schema compiler、provider capability matrix、转换 profile 或报告类型。

R1 不定义 `ToolExecutionPolicy`。`Exclusive` / `ParallelSafe` 无法表达调用参数决定的路径冲突，也没有当前消费者；等 scheduler 的资源模型确认后，再决定静态声明、逐调用 claim 与全局锁分别属于哪个边界。

### 3.2 `Tool`

```rust
pub struct Tool {
    // private fields
}

impl Tool {
    pub fn new(spec: ToolSpec, executor: std::sync::Arc<dyn ToolExecutor>) -> Self;
    pub fn spec(&self) -> &ToolSpec;

    pub(crate) async fn execute(
        &self,
        call: &ToolCall,
        working_dir: &std::path::Path,
    ) -> anyhow::Result<ToolResult>;
}
```

`Tool` 是唯一将“模型看到的契约”和“宿主实际执行器”绑定的运行时对象。executor 不在 `ToolSpec` 中定义 schema；spec 也没有 IO 回调。

### 3.3 `ToolRegistry`

Registry 的构建与使用分成两个阶段：

```text
agent 按 preset 选择 agent-tools definitions
  → ToolDefinition::build
  → 得到 Vec<Tool>
  → validate all tools
  → reject duplicate names
  → freeze
  → 当前 LLM step 使用 snapshot
```

要求：

1. frozen snapshot 在一个 LLM step 内不可变；
2. 迭代顺序稳定，model input compilation 和测试不依赖 HashMap 顺序；
3. lookup、schema 暴露和执行器绑定来自同一 `Tool`；
4. 动态/MCP 工具变化从下一 step 的新 snapshot 生效；
5. 每个 input schema 在 registry 构造时编译一次，调用时复用缓存的 validator；
6. registry 不包含 permission callback、session writer、UI emitter 或 scheduler queue。

`ToolSpec::new` 完成名称等本地字段校验，但不编译 schema。构造器 `ToolRegistry::new(Vec<Tool>) -> anyhow::Result<Self>` 完成 schema 文档校验与 validator 编译、重名校验、按工具名稳定排序，并返回包含 validator 缓存的已冻结值；任一 schema 非法则整体失败，错误必须包含对应工具名。registry 没有 `&mut` API；`resolve` 与 `iter` 只返回只读 `Tool` 引用，外部不能替换 spec、executor 或 validator。

```rust
pub struct ToolRegistry {
    // private, already-sorted immutable tools + cached input validators
}

impl ToolRegistry {
    pub fn new(tools: Vec<Tool>) -> anyhow::Result<Self>;
    pub fn resolve(&self, name: &str) -> Option<&Tool>;
    pub fn iter(&self) -> std::slice::Iter<'_, Tool>;

    pub(crate) fn validate_input(
        &self,
        tool: &Tool,
        call: &ToolCall,
    ) -> Result<(), String>;
}
```

`validate_input` 只接受由同一 registry 的 `resolve` 返回的 `Tool`；这一 provenance 是 loop 的固定调用顺序与结构测试守门的不变量，不额外创建 resolved wrapper。返回的 `String` 是预期参数错误的确定性模型可见说明，不使用 `anyhow::Error`；registry 构造后 validator 缺失属于实现不变量破坏，测试必须阻止该状态。

### 3.4 `ToolCall`

```rust
pub struct ToolCall {
    // private fields
}

impl ToolCall {
    pub fn new(
        tool_use_id: impl Into<String>,
        name: impl Into<String>,
        input: serde_json::Value,
    ) -> anyhow::Result<Self>;
    pub fn tool_use_id(&self) -> &str;
    pub fn name(&self) -> &str;
    pub fn input(&self) -> &serde_json::Value;
}
```

`ToolCall` 是模型请求事实的运行时表示。它不携带 executor、permission 结果或 session item id；这些信息属于不同阶段。

`ToolCall::new` 是进入 tools 的身份守门；解析约束由 `loop` 保证，tools 负责再次守门：

- `tool_use_id` 非空；
- `name` 非空；
- `input` 已经是 `serde_json::Value`，不再重复做文本 JSON 解析；
- 找不到 name 时不能 panic，应生成 `UnknownTool` 结果。

### 3.5 `ToolExecutor`

```rust
pub trait ToolExecutor: Send + Sync {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a std::path::Path,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = anyhow::Result<ToolResult>> + Send + 'a>,
    >;
}
```

R1 不定义通用 execution context。`working_dir` 是当前唯一有真实消费者的宿主执行环境，因此作为显式参数传入；它定义相对路径和子进程工作目录，不能通过修改进程全局 cwd 表达。tools 不验证目录存在性或替换路径。`run_id`、`session_id`、`turn`、cancellation token、SessionStore、EventDispatcher、permission engine、LLM provider 和 UI 等高层能力不下沉给 executor。出现新的真实执行参数后，再判断应继续显式传递还是建立窄领域结构。

`ToolCall` 以共享借用传入 executor。tools 保留调用事实所有权，因此执行完成后可用同一 call 生成 `ToolResult`，无需复制 identity；executor 也不能消费或替换调用身份。

执行前与执行中等待的 Turn cancellation 均由 loop 用 `CancellationToken` 处理。executor future 尚未开始时可安全生成 `Cancelled { User }`；future 已开始后取消时，副作用无法确认，loop 生成 `OutcomeUnknown`。tools 不接收 cancellation token，也不定义 `ToolAdmission` 或阶段型 call wrapper；具体 executor 可自行响应被 drop 的 future，但不能据此把未知副作用伪装成确定失败。

约束：

- executor 只接收已经由 loop 完成输入校验且 permission 允许的单个调用；
- executor 不自行决定 permission；
- executor 不生成/修改 `tool_use_id`；
- executor 不写 Session 或 TurnEvent；
- 预期业务失败返回 `Ok(ToolResult::failed(call, ...))`；
- IO、进程、协议等基础设施错误返回 `Err(anyhow::Error)`；
- 不使用 `unwrap`、`expect` 或 panic 处理外部输入。

### 3.6 `ToolResult`

```rust
pub enum ToolContent {
    Text(String),
    Json(serde_json::Value),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCancellationReason {
    User,
    Parent,
    Hook,
    Disposed,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolResultStatus {
    Succeeded,
    Failed { retryable: bool },
    InvalidArguments,
    UnknownTool,
    Denied,
    Cancelled { reason: ToolCancellationReason },
    OutcomeUnknown,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ToolResult {
    // private fields
}

impl ToolResult {
    pub fn tool_use_id(&self) -> &str;
    pub fn name(&self) -> &str;
    pub fn status(&self) -> &ToolResultStatus;
    pub fn content(&self) -> &ToolContent;

    pub fn succeeded(call: &ToolCall, content: ToolContent) -> Self;
    pub fn failed(call: &ToolCall, content: ToolContent, retryable: bool) -> Self;
    pub fn outcome_unknown(call: &ToolCall, content: ToolContent) -> Self;

    pub(crate) fn with_status(
        call: &ToolCall,
        status: ToolResultStatus,
        content: ToolContent,
    ) -> Self;
}
```

`ToolResultStatus` 是跨 session/event 接缝的持久化类型，使用稳定的 `serde` snake_case 表示；`Failed { retryable }` 序列化为带 `retryable` 字段的对象。`ToolCall` 与 `ToolResult` 都有稳定 serde 表示，SessionItem 直接 flatten 它们，不复制字段。

`ToolContent` 使用显式 `{ "type", "value" }` adjacent tag，而不是 untagged enum。`Text("ok")` 与 `Json(json!("ok"))` 在 JSON 值层本来不可区分；省略 tag 会让 Session 往返改变 variant 和模型可见渲染。v1 读取迁移把历史 string 映射为 Text，其他 JSON 形状映射为 Json；v2 写入始终带 tag。

`ToolCall` 与 `ToolResult` 是单次调用生命周期仅有的两个结构体。executor 直接返回 `ToolResult`，不再增加 output、invocation、outcome 或 event 结构重复表达同一事实。字段私有且跨 crate 只读，上层可直接将结果持久化或转换成模型的 ToolResult block。

executor 使用公开的 `succeeded` / `failed` / `outcome_unknown` 构造器；loop 使用 crate 内 `with_status` 生成 `UnknownTool`、`InvalidArguments`、`Denied` 或 `Cancelled`。所有构造入口都接收原始 `ToolCall` 并复制稳定身份，不能自行指定 `tool_use_id`。`Tool::execute` 还会核验 executor 返回结果的 id/name 与允许状态集合；身份不匹配，或 executor 返回 pipeline-owned 状态，都会立即返回错误。不引入 rejection typestate；状态与调用顺序由 loop 行为测试守门。

`Denied`、`Cancelled`、`InvalidArguments` 等不是 executor 的业务结果，而是调用管线的结果。handler 不能通过返回普通内容伪造这些状态。

R1 只保留一份结果载荷。结构化结果使用 `ToolContent::Json` 表达，由 loop 映射成模型可见的稳定文本；没有明确消费者前，不增加独立的 host-only 载荷。

---

## 4. 单次调用算法

```text
loop:
  1. ToolCall::new 已完成 identity 校验
  2. tool = registry.resolve(call.name)
     └─ missing → ToolResult::with_status(call, UnknownTool, content)
  3. registry.validate_input(tool, call)
     └─ invalid → ToolResult::with_status(call, InvalidArguments, content)
  4. 按 call.name 查询组合根注入的 ToolPermissionMap
     ├─ missing                 → ToolResult::with_status(call, Denied, content)
     ├─ Ask 且用户拒绝          → ToolResult::with_status(call, Denied, content)
     └─ Allow / Ask 经用户确认  → continue
  5. match tool.execute(&call, working_dir).await
     ├─ Ok(result) → continue
     └─ Err(error)
          → ToolResult::outcome_unknown(&call, safe_error_summary)
          → emit ToolResultRecorded
          → return Err(error) to turn boundary

Tool::execute:
  6. result = tool.executor.execute(&call, working_dir).await?
  7. verify result identity matches call and status belongs to executor result set
  8. return result
```

输入校验和执行边界由 tools 提供，permission map lookup 与总体顺序由 loop 编排。这里不为阶段顺序创建 `ValidatedToolCall` 或 `ToolAdmission`；顺序不变量由 loop 测试守门。`ToolResultStatus::Failed { retryable }` 必须保留 retryable；`OutcomeUnknown` 不得降级为成功。

多调用算法不属于 tools。Loop R1 已确认：一个 ToolUse response 的全部 ToolCall 先 commit，再按模型顺序逐个执行并 commit ToolResult；fatal error/cancel 后，剩余未开始 siblings 由 loop 记录 `Cancelled { Parent }`。后置 scheduler 只在此闭合不变量外接管并发窗口、资源冲突、tool retry 与模型 offload，不进入单调用 tools 边界。

---

## 5. 错误边界

| 场景 | tools 结果 | 是否继续 turn |
|------|------------|--------------|
| registry 中存在非法 schema 文档 | `ToolRegistry::new` 返回 `anyhow::Error`，不产生 registry | 不启动该配置 |
| 未知工具 | `UnknownTool`，模型可见 | 通常继续，让模型修正 |
| 调用 input 不匹配 schema | `InvalidArguments` | 通常继续 |
| permission 拒绝 | `Denied` | 由 loop/policy 决定 |
| 工具业务失败 | `Failed { retryable }` + 文本/结构化原因 | 通常继续 |
| 调用被取消且未开始 | `Cancelled { User }`；未开始 sibling 为 `Parent` | loop 闭合 round 后结束 Turn |
| 执行中断但副作用未知 | `OutcomeUnknown`；未开始 sibling 为 `Parent` | loop 闭合 round 后传播取消/错误 |
| executor IO/协议基础设施故障 | loop 先记录 `OutcomeUnknown`，再把原始 `anyhow::Error` 传到 turn 边界 | 不吞错，不留下未配对 invocation |

工具预期失败是模型输入的一部分；基础设施故障是运行边界错误。两者不能都编码成一段普通字符串。`Tool::execute` 不吞基础设施错误，也不自行 emit；loop 使用仍持有的 `ToolCall` 先记录一个 `OutcomeUnknown` 的配对结果，再传播原始错误。R1 不为基础设施故障复制 `InternalError` / `Unavailable` 状态，也不为尚无 scheduler/loop producer 的 timeout 预留 `TimedOut`；出现真实 producer 与恢复语义后再扩展。

---

## 6. 与相邻模块的接缝

### 6.1 与 `llm`

`tools` 不持有 provider，也不认识厂商 wire protocol。

```text
ToolSpec ──model_input::compile──► llm::protocol::ToolSchema
ToolResult ──loop 映射──────► llm::protocol::ContentBlock::ToolResult
```

当前 `llm::protocol::ToolSchema` 只有 name、description、input schema，与 tools R1 契约一致。

`model_input` 只复制 canonical schema，不改写关键词。具体 LLM adapter 编码时默认透传；已确认的 provider 关键词异常可以在该编码路径中做最小转换，但不反向改变 `ToolSpec` 或 registry validator。该兼容工作属于 R4 接缝，不进入 tools RB1。

### 6.2 与 `ToolPermissionMap`

permission 声明不进入 `ToolSpec`，当前也不设独立模块。组合根注册工具时同时构造声明式 map，并注入 `loop`：

```text
ToolRegistry:      tool_name → Tool { spec, executor }
ToolPermissionMap: tool_name → Allow | Ask
```

二者必须满足 key 集完全一致：registry 中不能有未声明 permission 的工具，permission map 也不能引用未知工具。该不变量由 loop 的 `ToolRuntime::new(registry, permissions, approval)` 构造检查和 conformance 测试守门；存在 `Ask` 时必须注入 `ToolApprovalHandler`。运行时缺失项作为安全兜底映射为 `Denied`，绝不默认 allow。`Deny` 不作为声明值：禁用工具从 registry 移除，不再暴露给模型。

`loop` 按 name 查询 map，并用显式 approval port 处理 `Ask`；Hook 不能授权、拒绝或取消调用。sidecar 只能提供 executor，不能修改宿主 permission map。只有路径、命令前缀、session scope 或动态风险等真实规则出现后，才重新评审是否提取独立模块。

### 6.3 与 `scheduler`

tools R1 只提供单次调用与结果契约，不预设 scheduler 的资源模型。Loop R1 先固定顺序执行并负责 Turn cancellation；scheduler 后续结合调用集合、参数和资源决定并行计划与 tool retry。出现明确模型后，再评审是否需要扩展 `ToolSpec`。

```text
calls + confirmed resource claims + cancellation
    → scheduler execution plan
```

`verify`、模型 offload、failover 和 retry 不属于 tools。

### 6.4 与 `session` / `event`

tools 不直接写盘、不发布 event。loop/event 按既定顺序负责：

```text
ToolCallRecorded   { call }   → session::ToolCall   { call }
ToolResultRecorded { result } → session::ToolResult { result }
```

Session Item Log 是事实源；Agent Event Log 只是 TurnEvent derive 的观测记录。

该接缝直接携带完整 `ToolResult`，因此 typed `ToolResultStatus` 不会丢失。这是高层对 tools **契约类型**的单向依赖，tools 不依赖高层实现。

loop 集成仍必须覆盖 executor `Err` 路径：loop 先 emit status 为 `OutcomeUnknown` 的 `ToolResultRecorded`，等待 commit 成功后再把原始 `anyhow::Error` 返回 turn 边界。禁止只记录 call 后直接 `?` 返回；也禁止 event/session 层自行猜测或补写 result。

Session Item Log 已升级到 v2，新写入使用 `tool_call` / `tool_result`。读取 v1 时通过 serde alias 接受旧 kind，对缺失 status 的历史结果映射为 `OutcomeUnknown`，禁止默认推断为 `Succeeded`。

LLM 的 `ContentBlock::ToolResult` 仍只承载模型可见 content。loop 先使用 typed status 决定控制流，再把 status 说明编码为 content；不能在恢复或控制流中从 content 文本反推 status。

---

## 7. 不变量

### Registry

1. 一个 frozen snapshot 内工具名唯一；
2. `ModelRequest.tools` 中的 schema 与实际 executor 来自同一 `Tool`；
3. snapshot 冻结后不能增删改；
4. registry 迭代顺序稳定；
5. 任一 input schema 非法时 registry 构造整体失败；
6. input validator 在 registry 构造时编译，调用时复用；
7. registry 不执行权限、调度或 IO；
8. registry 的外部 API 没有可变引用，`Tool` 的 spec/executor 不能被替换。

### Call

9. `tool_use_id` 非空；注册的 `name` 匹配 `^[A-Za-z0-9_-]{1,64}$`；
10. 未知工具和非法输入不 panic；
11. input 不匹配 schema 时 permission 与 executor 均不调用；
12. 每个已记录的 `ToolCall` 都必须生成且只生成一个可配对的 `ToolResult`；executor 基础设施错误先记录 `OutcomeUnknown`，再传播原始错误；
13. handler 不能修改调用身份或伪造 permission/scheduler 状态；`Tool::execute` 同时校验身份和 executor 允许状态集合。

### Result

14. `status` 与 `content` 独立；
15. `Failed { retryable }` 的 retryable 信息不能丢失；
16. `OutcomeUnknown` 不能降级成 `Succeeded`；
17. 预期业务失败可模型可见；基础设施错误在配对 outcome 提交后向上传播；

### Integration

18. tools 不写 Session Item Log；
19. tools 不产生 TurnEvent；
20. R1 多调用顺序与取消补偿归 loop；并发、资源调度、tool retry、offload 验收归 scheduler；
21. 动态 registry 变化下一 step 才生效；
22. session/event 直接包装 `ToolCall` / `ToolResult`，不得复制同义字段结构。

---

## 8. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | `ToolSpec`、`ToolCall`、`ToolExecutor`、`ToolResult` |
| **R2** | frozen registry、重复注册、稳定排序、input schema 守门 |
| **R3** | 输入校验、executor 调用、错误/未知结果规范化 |
| **RB2** | 删除重复结果模型；SessionItem/TurnEvent 直接携带 `ToolCall` / `ToolResult`；Session v2 兼容读取 v1 |
| **R4** | 与 model_input、loop 的 ToolRuntime、permission/approval、顺序 round、cancellation 联调 |
| **后置** | scheduler 资源 claim、bounded pool、模型 offload/failover、artifact spill |

每批实现前先更新本文件的类型和不变量，再由 `batch-implement` 按 review 批推进。实现阶段发现必须改变上述公开签名时，停止当前批次，先回架构对齐；不能在 TASKS 中以“必要时补充文档”代替确认。`tools` 设计不因后置 scheduler 的复杂度提前膨胀。

---

## 9. 单测方向

- 空名称、非法字符、超过 64 字节的名称、重复名称被拒绝；
- 非 object 或非法 Draft 2020-12 schema 被拒绝；错误包含工具名且不产生部分 registry；
- registry 冻结后不能改变，顺序稳定；
- registry 构造后调用复用已编译 validator，不做 lazy schema 初始化；
- registry 不暴露可变 `Tool`；
- `ModelRequest.tools` 中的 schema 与 dispatch 使用同一 `Tool`；
- `ToolCall::new` 拒绝空 identity，合法 identity 的 unknown tool 仍返回可配对结果；
- registry `resolve` 未命中返回 `None`，`ToolResult::with_status` 可表达 `UnknownTool`；完整映射顺序由 loop 集成测试守门；
- 非法 input → `InvalidArguments`，且 executor 不被调用；
- permission 的 allowed/denied 顺序与映射在 loop 集成批测试，不在 tools RB1 伪造 admission；
- ToolRuntime 构造拒绝 registry/permission key 漂移；存在 Ask 时必须有 approval handler；
- 一个 response 的全部 ToolCall 在任何 executor 前完成 commit，随后按模型顺序产生全部配对结果；
- cancellation / approval Cancelled / approval Err / executor Err 的当前与剩余 sibling 状态由 loop 集成测试守门；
- expected business failure → `Failed { retryable }` + 内容；
- executor infrastructure error → tools 原样向上传播；loop 先提交一次 `OutcomeUnknown` 配对结果，再返回同一错误；
- `OutcomeUnknown` 不会被归一成成功；
- `ToolContent::Json` 的 LLM 映射稳定，结果载荷不重复维护；
- 每个成功进入执行的 call 都能生成稳定的 result 配对信息；
- executor 返回不同调用身份或 pipeline-owned 状态的 result 会在 `Tool` 边界失败；
- v1 tool item 可读取为新模型，缺失 status 保守映射为 `OutcomeUnknown`；
- tools 不 import session/event/loop/scheduler 的结构测试守门。

---

## 10. 决策记录

1. tool 是受控调用管线，不是函数表；
2. spec 与 executor 分离；
3. registry 只做能力目录和绑定，不做授权；
4. `ToolExecutor` 是唯一工具 trait；
5. tools 只负责单次调用，scheduler 负责多调用调度；
6. ToolResult 状态与 content 分离；
7. Session Item Log 记录事实，TurnEvent 记录派生观测；
8. 模型 offload、验收、retry、failover 不属于 tools；
9. 当前 step 使用 frozen registry snapshot；
10. 先完成稳定单调用契约，再引入资源调度和大结果 spill。
11. 当前 MVP 的执行前门禁只有 input validation 与 permission check；不引入阶段对象或 scheduler admission。
12. R1 只保留 `input_schema`；`output_schema` 等明确结构化消费者出现后再评审。
13. input schema 在 frozen registry 构造时校验并编译一次；schema 错误阻止注册，调用 input 错误返回 `InvalidArguments`。
14. provider schema 编码默认透传，只修复已确认的关键词异常；不在 tools 内建设通用兼容层。
15. permission 是组合根声明的 `tool_name → Allow | Ask` map，由 loop 私有查表；当前不设独立模块。
16. 单次调用生命周期只用 `ToolCall` 与 `ToolResult` 两个结构体建模，不保留同义 output/invocation/outcome/event 结构。
17. executor 使用公开的成功/失败/未知结果构造器；loop 使用 crate 内 `with_status`，两者都只能从原 `ToolCall` 复制身份。
18. executor 只借用 `ToolCall`，并显式接收 `working_dir`；不复制调用身份，也不使用进程全局 cwd。
19. registry 以 crate 内部 `validate_input(tool, call)` 暴露缓存校验；`Tool::execute` 隐藏 executor 并核验结果身份，不增加执行 service 或阶段 wrapper。
20. executor `Err` 不转成新的基础设施状态；loop 先记录 `OutcomeUnknown` 配对结果，再传播原始错误。
21. `agent-core::tools` 保留运行时契约；第一方实现归 `agent-tools`，其 `ToolDefinition` 表达 name + build 配方；依赖只能是 `agent-tools → agent-core`，`Tool` 仍是唯一进入 runtime registry 的绑定。
22. canonical 工具名采用当前 provider 共同支持的 `^[A-Za-z0-9_-]{1,64}$`；`input_schema` 顶层必须是 JSON object，避免注册成功后在首次 provider 请求才失败。
23. `ToolRuntime` 是 loop 的装配聚合，不属于 tools，也不复制 registry/executor。
24. Loop R1 固定顺序 round：先记录全部 calls，再逐个执行并配对；scheduler 后置不改变“每 call 恰好一个 result”。
25. Turn cancellation 由 loop 的 CancellationToken 负责；执行中取消映射 OutcomeUnknown，Hook 不生产取消。

---

<a id="event"></a>

## event

## 1. 职责与边界

| 做 | 不做 |
|----|------|
| `TurnEvent` 语义协议 | Turn/Step/tool 状态机（loop） |
| 同步 dispatch：commit → post-commit Hook | permission、approval、retry、cancel 决策 |
| `derive` → AgentEventRecord / recorder port | `SessionStore` 实现 |
| Hook registry 与 TurnEvent dispatch | sidecar IPC |
| event schema 与 derive mapping | Agent Event queue、worker、文件 IO |

**核心：** event 维护事实提交与扩展 callback 的顺序；它不拥有事实源，也不允许 Hook 改变正确性路径。

```text
Committable TurnEvent:
  mutable commit borrow → Hook* fail-open → observer bridge

Observational TurnEvent:
  Hook* fail-open → observer bridge
```

Agent Event Log 是 Hook 的一个消费者，不是 Session Item Log 的替代品。

---

## 2. 三条线

```text
  Session Item Log          ModelRequest            Agent Event Log
  （session）               （model_input）          （event derive）
        ▲                         │                        ▲
        │ commit                   │ compile                │ Hook
        └──────── dispatch ────────────────────────────────┘
                              ▲ emit
                           loop
```

---

## 3. 模块结构（目标）

```text
event/
  README.md
  DESIGN.md
  mod.rs
  turn_event.rs
  trace_context.rs
  pipeline.rs             # dispatch
  registry.rs             # frozen Hook registry
  derive.rs
  agent_recorder.rs       # AgentEventRecorder port / derive hook
  observer_bridge.rs      # 后置 observer bridge
  tests.rs
```

当前 AgentEventRecord、wire schema 与 derive mapping 保留。默认不装配 Agent Event
queue、worker 和 FileAgentEventRecorder；启用诊断 policy 时由 `agent::log` 装配，event
core 不拥有 Tokio worker 或物理文件 IO。

---

## 4. `TurnEvent`

### 4.1 Committable

| `TurnEvent` | → `SessionItem` | 时机 |
|-------------|-----------------|------|
| `UserPromptCommitted` | `UserMessage` | LLM 前 |
| `AssistantFinalized` with non-empty blocks | `AssistantMessage` | 完整 assistant blocks 确认后 |
| `AssistantFinalized` with empty blocks | no Session item | tool-only successful call 的 finalized marker |
| `ToolCallRecorded { call }` | `ToolCall { call }` | tool 副作用前 |
| `ToolResultRecorded { result }` | `ToolResult { result }` | 单 call 结果确定后 |
| `CompactionApplied` | `Compaction` | 后置 context policy |

### 4.2 Observational

| `TurnEvent` | Agent Event channel |
|-------------|---------------------|
| `TurnStarted` / `TurnEnded` | `trace` |
| `LlmCallStarted` / `LlmCallEnded` | `trace` |
| `MessageUpdate` | `trace` |
| `ContextPreflightEnded` / `ContextPostflightEnded` | `context` |
| `CompactionRecommended` | `context` |

Observational event 不借 commit handler 写入事实源。为了保持一个统一入口，`emit` 仍接受 mutable commit borrow，但对这类事件不调用它。

---

## 5. Target dispatch 算法

```text
emit(commit, event):
  clear TraceContext transient fields:
    session_item_id = None
    tool_use_id = None
    llm_call_id = None
  update TraceContext correlation fields from event

  if event.is_committable():
    session_item_id = commit.commit(&event)?
    trace.session_item_id = session_item_id

  for hook in registry.hooks:
    if hook.on_event(&trace, &event) returns Err:
      diagnose error
      continue

  observer_bridge.publish(event)  # optional; failure ignored
  return Ok
```

同步 commit 是正确性路径；Hook 和 observer bridge 都是观测扩展。Committable event 的 Hook 只在 commit 成功后看到事件，因此不能观测到“声称已提交但实际失败”的事实。Transient identity 只属于当前 emit；Hook 不从 TraceContext 读取上一事件的 `session_item_id`、`tool_use_id` 或 `llm_call_id`。

Hook 调用顺序等于 frozen registry 的注册顺序；一个 Hook 失败不能跳过后续 Hook。诊断输出使用 logger/stderr，不递归 emit 新 TurnEvent。

---

## 6. Loop R1 时序接缝

```text
Turn:
  materialize existing Session Item Log
  next_turn
  emit TurnStarted                       # observational
  emit UserPromptCommitted               # commit UserMessage

  Step 0..max_steps:
    materialize → compile
    emit LlmCallStarted
    llm::run_model_call* → MessageUpdate*
    emit exactly one LlmCallEnded for every attempt, with its outcome

    terminal response:
      emit AssistantFinalized            # no tool blocks
      emit TurnEnded

    ToolUse response:
      emit AssistantFinalized once; use empty blocks when the response is tool-only
      emit every ToolCallRecorded         # all calls before side effects
      sequentially process and emit every ToolResultRecorded
      next Step, or close round then fail at max_steps
```

硬顺序：

1. `UserPromptCommitted` 成功先于首个 LLM attempt；
2. 一个成功完成的 LLM call 恰好产生一个 `AssistantFinalized`；非空 blocks 才写入 Session，tool-only 的空 marker 不写入 Session；
3. 同一 round 的全部 ToolCall 先于任何 executor 副作用；
4. 每个 call 恰好一个 ToolResult，下一 Step 前 round 全量闭合；
5. executor Err / 执行中取消的当前 result 是 `OutcomeUnknown`，未开始 siblings 是 `Cancelled(Parent)`。

重试 attempt 复用同一 Step，但使用新的 `llm_call_id`。每个 attempt，无论成功、请求失败、无效响应或取消，都恰好产生一个 `LlmCallEnded`；失败 attempt 的 partial updates 只在 Agent Event 中出现，不 commit AssistantMessage。

---

## 7. 类型签名

### 7.1 `LlmCallOutcome`

```rust
pub enum LlmCallFailureKind {
    Request(RequestFailureKind),
    InvalidResponse,
}

pub enum LlmCallOutcome {
    Succeeded {
        stop_reason: StopReason,
        usage: Option<Usage>,
    },
    Failed {
        kind: LlmCallFailureKind,
    },
    Cancelled {
        reason: CancelReason,
    },
}
```

`LlmCallOutcome` 是运行时语义，不承载 provider 原始错误文本；详细诊断继续由 logger 记录。`StopReason`、`RequestFailureKind` 和 `CancelReason` 保持 enum，不在 progress 或 frontend API 中降级为状态字符串。

### 7.2 `TurnEvent`

```rust
pub enum TurnEvent {
    TurnStarted { turn: u64 },
    TurnEnded { turn: u64 },

    UserPromptCommitted { turn: u64, text: String },
    AssistantFinalized {
        turn: u64,
        llm_call_id: String,
        blocks: Vec<ContentBlock>,
    },
    ToolCallRecorded { turn: u64, call: ToolCall },
    ToolResultRecorded { turn: u64, result: ToolResult },

    LlmCallStarted { turn: u64, step: u32, llm_call_id: String },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        outcome: LlmCallOutcome,
    },
    MessageUpdate {
        turn: u64,
        step: u32,
        llm_call_id: String,
        snapshot: ModelResponseSnapshot,
    },

    CompactionApplied { /* current fields */ },
    CompactionRecommended { turn: u64 },
    ContextPreflightEnded { turn: u64 },
    ContextPostflightEnded { turn: u64 },
}
```

### 7.2 `TraceContext`

```rust
pub struct TraceContext {
    pub run_id: String,
    pub session_id: String,
    pub turn: u64,
    pub step: u32,
    pub llm_call_id: Option<String>,
    pub tool_use_id: Option<String>,
    pub session_item_id: Option<String>,
}
```

`TraceContext.run_id` 是 legacy Agent Event 分区字段，不是领域 Run。Turn identity 仍是 `(session_id, turn)`；未来 OTel trace/span 接入另行设计，不在本批把 `TraceContext` 改名为 `EventContext`。

`session_item_id`、`tool_use_id`、`llm_call_id` 是 event-local transient correlation fields。每次 `emit` 开始清理三者，再由当前 TurnEvent 填充；`run_id` 与 `session_id` 是稳定上下文，不清理。

### 7.3 Handler traits

```rust
pub trait CommitHandler {
    fn commit(&mut self, event: &TurnEvent) -> anyhow::Result<Option<String>>;
}

pub trait HookHandler: Send + Sync {
    fn on_event(
        &self,
        ctx: &TraceContext,
        event: &TurnEvent,
    ) -> anyhow::Result<()>;
}
```

目标契约删除：

- `HookOutcome`：Hook 不返回 Block；
- `ObserveHandler`：与 post-commit Hook 语义重复；
- registry-owned `CommitHandler`：它会迫使 SessionStore 被长期共享或包进 Mutex。

### 7.4 Registry / dispatcher

```rust
pub struct PipelineRegistry {
    hooks: Vec<std::sync::Arc<dyn HookHandler>>,
}

pub struct ObserverEvent {
    pub context: TraceContext,
    pub event: TurnEvent,
}

pub struct ObserverBridge { /* bounded Tokio sender */ }

impl ObserverBridge {
    pub fn channel(
        capacity: usize,
    ) -> anyhow::Result<(Self, tokio::sync::mpsc::Receiver<ObserverEvent>)>;

    pub fn try_publish(&self, context: &TraceContext, event: &TurnEvent);
}

pub struct EventDispatcher {
    registry: PipelineRegistry,
    trace: TraceContext,
    observer_bridge: Option<ObserverBridge>,
}

impl EventDispatcher {
    pub fn with_observer_bridge(self, bridge: ObserverBridge) -> Self;

    pub fn emit(
        &mut self,
        commit: &mut dyn CommitHandler,
        event: TurnEvent,
    ) -> anyhow::Result<()>;
}
```

Registry 由 agent 构造并冻结；EventDispatcher 由 AgentLoop 独占持有。Hook 使用 `Arc` 是因为不同实现可动态装配并作为测试 seam；commit 使用短期 `&mut` 是因为它只有一个正确性 owner。

### 7.5 Agent Event derive Hook

```rust
pub fn derive_agent_event(
    ctx: &TraceContext,
    event: &TurnEvent,
) -> anyhow::Result<Option<AgentEventRecord>>;

pub trait AgentEventRecorder: Send + Sync {
    /// Must be non-blocking for the EventDispatcher caller.
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}

pub struct DeriveAgentEventHook { /* recorder */ }

impl HookHandler for DeriveAgentEventHook {
    fn on_event(
        &self,
        ctx: &TraceContext,
        event: &TurnEvent,
    ) -> anyhow::Result<()>;
}
```

`DeriveAgentEventHook` 只调用 `derive_agent_event` 并转交 `AgentEventRecorder`。具体 queued recorder、worker 和 FileAgentEventRecorder 位于 `agent::log`；`append` 只做 bounded `try_send`，不能同步写文件。

`derive_agent_event` 使用私有借用 DTO 固定 Agent Event wire schema，序列化失败返回 `Err`。ToolCall/ToolResult 直接来自 canonical tools 契约；wire DTO 不形成并行领域模型。

`agent::log::AgentEventLogWorker` 负责校验 `runId`、恢复下一个 `seq` 与最后
`turn`、64 KiB JSONL 截断和批量 flush；rotation 和 retention 后置。queue 只按事件
数量 bounded；队列满时不等待，累计 `dropped_events` 并进入 `Degraded`。
`dropped_bytes`、byte-budget queue 和 metrics exporter 后置。默认 `DiagnosticPersistence::Off`
不装配 Agent Event Log worker；启用诊断 policy 时由 `agent::log` 装配。它与
ProgressWorker 使用不同 queue、writer 和状态。

---

## 8. import 边界

```text
event → llm::protocol
event → tools（只读 ToolCall / ToolResult）
event ↛ loop
agent::log → event::{AgentEventRecord, AgentEventRecorder}

session → event::CommitHandler + TurnEvent（直接实现 mutable seam）
loop → EventDispatcher::emit + TurnEvent
agent → PipelineRegistry + concrete Hook/recorder assembly
cli → observer bridge 或 tail runs/*.active.jsonl
```

`event` 不 import SessionStore。`session` 已经拥有 TurnEvent → SessionItem 的 commit mapping，因此实现 CommitHandler 不新增反向编排依赖。

---

## 9. 不变量

1. loop 不直接 `commit_item`；
2. Observational event 不调用 commit；
3. Committable event 先 commit，成功后 Hook 才能观察；
4. commit error 原样传播，Hook error fail-open；
5. Hook 不能 Block、Approve、Cancel、Retry 或修改 event；
6. Hook 顺序稳定，一个失败不跳过后续 Hook；
7. 每次 emit 清理 transient correlation fields，Hook 和 observer bridge 只能看到当前 event 的 identity；
8. EventDispatcher / PipelineRegistry 不拥有 SessionStore；
9. derive 不写回 Session Item Log；
10. observer bridge 在全部 Hook 之后 publish，不参与 commit 完成条件；
11. `TurnEvent` 增加字段时同步 dispatch、derive、commit 与结构测试；
12. Agent Event / Session Item schema 的持久化变化另行版本化；
13. tool event 直接包装 ToolCall / ToolResult，不复制领域字段；
14. file recorder 与 FileWriter 职责保持分离；
15. legacy `runId` 不引入 Run 执行实体。

---

## 10. 错误策略

| 阶段 | 策略 |
|------|------|
| commit `Err` | 停止当前 dispatch，向 loop 传播 |
| Hook `Err` | 记录诊断，继续后续 Hook，最终 `Ok` |
| Agent Event derive/append `Err` | 作为 Hook error fail-open，不回滚 Session |
| observer bridge 失败 | 忽略 |

Hook 的 fail-open 不是吞掉诊断：实现必须至少经 logger/stderr 记录 hook identity 与错误上下文，但不能递归 emit。

---

## 11. 决策记录

1. TurnEvent 是内核运行语义；Agent Event 是 derive 的观测 wire；
2. Session commit 是同步正确性路径，observer bridge 只是后置观测扩展；
3. Hook 的本质是可维护/可扩展 callback，不是决策链；
4. Hook 统一在 commit 后运行并 fail-open；Observational event 直接进入 Hook；
5. 删除 `HookOutcome::Block` 与重复 `ObserveHandler`；
6. CommitHandler 从 registry 移出，EventDispatcher 每次 emit 借用 mutable handler；
7. SessionStore 直接实现 commit seam，不再用 Mutex wrapper 转移所有权；
8. AgentEvent、schema、recorder、storage、file writer 在接缝迁移中必须保留；
9. tool event 直接携带 canonical ToolCall/ToolResult；
10. 删除执行领域 Run；legacy `runId` / `runs/` 暂不迁移；
11. OTel trace/span 与 EventContext 命名等 observability 接入时再设计；
12. TraceContext 的 transient identity 只服务当前 emit，避免跨事件残留关联。

---

## 12. 实现分期

| 批 | 范围 | 状态 |
|----|------|------|
| **R1** | TurnEvent + TraceContext + EventDispatcher + handlers | 已实现旧 pipeline |
| **R2** | derive + channel mapping | 已实现 |
| **R3-legacy** | session commit + Agent Event recorder port | 文件 adapter 已迁移至 `agent::log` |
| **R3-F2** | ToolCall/ToolResult typed payload | 已实现 |
| **R4-A** | borrowed mutable CommitHandler；post-commit Hook；Observe adapter 合并；保留 AgentEvent 栈 | 已实现于 Loop R1 |
| **R4-Observer** | bounded post-commit observer bridge | 已实现 |
| **R4-Sidecar** | observer bridge → sidecar transport | 后置 |

R4-A 应作为 loop `batch-implement` 的第一批接缝任务。它不授权删除任何已存在的观测能力。

---

## 13. 单测方向

- Committable 先调用 mutable commit，再调用 Hook；Observational 不调用 commit；
- commit Err 时 Hook 不运行且原错误传播；
- Hook Err 被诊断、后续 Hook 仍运行、dispatch fail-open；
- Hook trait 没有 Block/decision 返回值；
- PipelineRegistry 不拥有 CommitHandler；
- SessionStore 可直接作为连续 emit 的唯一 mutable commit target；
- Agent Event derive Hook 原样转交 record；
- observer bridge 在 Hook 后以 bounded `try_publish` 入队，queue/receiver 故障不传播到 dispatch；
- R4-A 前后 derive mapping、wire schema、64 KiB、seq/turn 恢复行为不变；
- tool call/result identity、input、status、content 不丢失；
- Turn/Step/round 顺序与 [`#loop`](#loop) 一致；
- event 不 import loop，legacy run identity 不产生 Run type。

---

<a id="model_input"></a>

## model_input

## 1. 职责

`model_input` 是一个窄的纯组装模块：消费上游已经解析、选择和物化的数据，产出一次 provider-neutral `llm::protocol::ModelRequest`。

它只负责三件事：

1. 表达稳定的 system prompt 值；
2. 收拢一次 model request 的调用配置；
3. 以唯一规则组装 config、system、messages 与 tool schemas。

这里的 **compile** 指结构编译，不指 prompt 文本生成、context 压缩或 provider 编码。

---

## 2. 非职责

以下能力明确留在相邻模块：

| 能力 | 所有者 |
|------|--------|
| 解析 `AGENTS.md`、rules、skills、工作目录信息 | `agent` / turn context resolution |
| Session Item Log → model-visible messages | `context::materialize` |
| tail window、compaction、prune、summary、artifact、retrieval | `context` |
| tool 注册、schema 校验、executor 绑定 | `tools` |
| model/messages/max_tokens 请求前置校验 | `llm` |
| provider wire 转换与已确认的关键词兼容 | `llm` adapter |
| 调用顺序、tool loop、事件发射 | `loop` |

本模块不引入 trait、builder、`ModelInput`、`CompileContext`、instruction section 或第二份 tool/config 模型。

---

## 3. 依赖方向

```text
agent ────────┐
context ──────┼──► loop ──► model_input ──► llm::protocol
tools ────────┘                    │
                                  └──────► tools
```

允许的内部 import：

```text
model_input ──► llm::protocol
model_input ──► tools
```

禁止 `model_input` import `agent`、`loop`、`context`、`session` 或 `event`。这些模块的生命周期和策略不能泄漏进纯组装边界。

---

## 4. 公开模型

### 4.1 `SystemPrompt`

```rust
pub struct SystemPrompt {
    content: String,
}

impl SystemPrompt {
    pub fn new(content: impl Into<String>) -> Self;
    pub fn content(&self) -> &str;
}
```

`SystemPrompt` 是已经解析完成的值，不保留来源路径、section、优先级或 reload 状态。空内容合法。

类型存在的意义是固定语义边界：调用者必须传入“本 turn 已解析的 system prompt”，不能把任意 `String` 的用途留给参数位置猜测。

### 4.2 `ModelRequestConfig`

```rust
pub struct ModelRequestConfig {
    pub model: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub session_id: Option<String>,
}
```

该结构只收拢 `ModelRequest` 中由运行配置解析出的字段。它不重复 `system`、`messages` 或 `tools`，也不拥有 provider endpoint、API key、permission 或 working directory。

### 4.3 `compile`

```rust
pub(crate) fn compile(
    config: &ModelRequestConfig,
    system_prompt: &SystemPrompt,
    messages: Vec<Message>,
    tool_registry: &ToolRegistry,
) -> ModelRequest;
```

参数设计：

- config 与 system 按引用读取，允许同一 turn 的多次 compile 复用；
- messages 按值接收并直接移动，避免无意义复制；
- registry 按引用读取，保证 schema 和本 step 可执行工具来自同一冻结快照；
- 返回 `ModelRequest`，不增加无失败路径的 `Result`。

`SystemPrompt` 与 `ModelRequestConfig` 由上层 `agent` 构造，因此跨 crate 公开；`compile` 的 runtime caller 只有同 crate 的 `loop`，必须保持 `pub(crate)`。

---

## 5. 编译算法

`compile` 按固定映射构造请求：

```text
ModelRequest.model          ← clone(config.model)
ModelRequest.system         ← clone(system_prompt.content)
ModelRequest.messages       ← move(messages)
ModelRequest.tools          ← registry.iter().map(spec_to_schema)
ModelRequest.max_tokens     ← config.max_tokens
ModelRequest.thinking_level ← config.thinking_level
ModelRequest.session_id     ← clone(config.session_id)
```

其中 tool 映射严格为：

```text
ToolSchema.name         ← clone(ToolSpec.name)
ToolSchema.description  ← clone(ToolSpec.description)
ToolSchema.input_schema ← clone(ToolSpec.input_schema)
```

不增加、删除或重写 JSON Schema 关键词。`ToolRegistry` 已按 name 排序，因此生成的 `tools` 顺序稳定；不得在 `compile` 中再次排序或改用无序 map。

---

## 6. 生命周期

### 6.1 turn 边界

组合根在一个 user turn 开始时运行 `resolveTurnContext`，解析一次 `SystemPrompt`、`ModelRequestConfig` 和该 turn 需要的其他稳定输入。

`SystemPrompt` 在整个 turn 内 immutable。即使 tool 修改规则文件，当前 turn 也不 reload；修改从下一个 user turn 生效。这保证一个 tool loop 中各 model step 的规则一致。

### 6.2 step 边界

每次 model call 前都重新调用 `compile`。原因是 messages 会在 assistant/tool 交互后变化，而 config、system 与冻结 registry 可以复用。

```text
user turn
  ├── resolve SystemPrompt once
  ├── materialize → compile → model step 1
  ├── append tool interaction
  └── materialize → compile → model step 2
```

---

## 7. context 接缝

R1 的 `messages: Vec<Message>` 是有意保持的小接口。`model_input` 假设 messages 已经是 model-visible 结果，不执行 materialize、compaction 或语义改写。

未来 context 是否产生诊断或选择元数据、以及其具体载体，均不在当前设计中确定；若出现真实消费者，必须回到 context 架构对齐。loop 在 R1 仍只取得 messages 并调用：

```text
context::materialize → loop 取得 messages → model_input::compile
```

context 的 token budget 后续必须扣除 system 与 tools 的 pinned 成本，才能决定 messages 可用预算。该约束属于 context 模块设计；R1 不预设预算返回结构、manifest 类型或 token counter trait。

---

## 8. 校验与错误边界

`compile` 是 infallible 的结构映射：

| 输入情况 | 行为 |
|----------|------|
| 空 `SystemPrompt` | 正常生成空 `system` |
| 空 `ToolRegistry` | 正常生成空 `tools` |
| 空 `messages` | 正常 compile；`llm` preflight 拒绝 |
| 空 model | 正常 compile；`llm` preflight 拒绝 |
| `max_tokens == 0` | 正常 compile；`llm` preflight 拒绝 |
| 非法 tool schema | 无法进入；`ToolRegistry::new` 已拒绝 |

不得在 `compile` 复制 `llm` preflight，也不得把 `ToolRegistry` 的结构不变量改成热路径 runtime assert。

---

## 9. R1 文件边界

目标实现保持小而直接：

```text
model_input/
├── README.md
├── DESIGN.md
├── mod.rs
├── compile.rs
└── tests.rs
```

- `mod.rs`：公开类型与 re-export；
- `compile.rs`：纯映射实现；
- `tests.rs`：结构不变量和边界用例。

不为两个简单 value type 拆更多文件，也不抽象通用 compiler trait。

---

## 10. R1 测试契约

实现阶段至少覆盖：

1. config、system、messages 全字段映射正确；
2. tool schema 完整复制且顺序与 registry 一致；
3. messages 按原顺序、原内容进入请求；
4. 空 system 与空 registry 可以 compile；
5. 空 model、空 messages 与零 max_tokens 分别可以 compile，证明本模块不复制 llm preflight；
6. 同一 config/system/registry 可用于同一 turn 的多次 compile，结果只随 messages 变化。

每个测试按仓库约束写清测试场景、预期结果和不变量/副作用边界。

“每 user turn 只解析一次 `SystemPrompt`”和“runtime 不绕过 `compile`”属于未来 loop/conformance 集成测试；本模块单测只证明值可复用和映射不改写。

---

## 11. 决策记录

| 决策 | 理由 |
|------|------|
| 模块名使用 `model_input` | 描述产物边界，避免把职责误解为 prompt 文本拼接 |
| `SystemPrompt` 而非 `InstructionState` | 模块只消费解析结果，不拥有 instruction 来源状态 |
| 不引入 `ResolvedInstructions` / `InputPrompt` | 前者暴露解析过程，后者无法表达完整 ModelRequest 输入 |
| `compile` 使用四个直观参数 | 参数角色稳定且数量可控；额外 context object 只会隐藏依赖 |
| `compile` 使用 `pub(crate)` | 唯一 runtime caller 是同 crate 的 loop；对外只暴露组合所需值类型 |
| `compile` 不返回 `Result` | 当前映射没有本模块拥有的失败条件 |
| messages 原样消费 | 语义 shaping 由 context 唯一拥有 |
| tool schema 轻量精确映射 | canonical schema 来自 registry；provider 兼容留给 adapter |
| SystemPrompt 每 turn 解析一次 | 防止同一 turn 的多 step 规则漂移 |

---

<a id="context"></a>

## context

> **状态：** R1 设计已确认，实现与测试已通过 Review。
> **公开用法：** [`src/context/README.md`](src/context/README.md)

## 1. 职责与边界

`context` 负责把 Session Item Log 的有序事实记录 materialize 为模型可见的 `Vec<Message>`。它是只读、确定性的装配模块，不是 session store、compaction engine 或 provider adapter。

R1 只兑现以下能力：

1. 保持 session item 的事实顺序；
2. 将普通 user/assistant item 映射到协议 message；
3. 将连续 tool call/result item 聚合为模型协议要求的 assistant/user block message；
4. 校验 tool call/result 的身份配对；
5. 对 R1 尚不能解释的 `Compaction` 显式报错。

明确不做：session 写入、事实修复、tool 执行、provider wire 转换、compaction/prune/retrieval、manifest 或预算计算。

## 2. 模块结构

实现阶段保持窄目录：

```text
context/
├── README.md
├── DESIGN.md
├── GitHub Issues
├── mod.rs
├── materialize.rs
└── tests.rs
```

- `mod.rs`：导出 crate 内部的 `materialize` 入口；
- `materialize.rs`：顺序遍历、分组、协议映射和配对校验；
- `tests.rs`：只验证 R1 语义和不变量。
- `GitHub Issues`：记录 Review 批范围与完成状态。

不为 manifest、预算、compaction policy 或通用 message builder 预留文件。

## 3. 类型与签名

```rust
use anyhow::Result;

use crate::{
    llm::protocol::Message,
    session::SessionItem,
};

pub(crate) fn materialize(
    items: &[SessionItem],
) -> Result<Vec<Message>>;
```

实现还需要读取 session item 内的 canonical `ToolCall` / `ToolResult` 与 `ToolContent`，因此允许 import `crate::tools` 的只读类型。context 不定义第二套 call/result 结构，也不改变 session item 的所有权。

返回值只有 `Vec<Message>`，不携带 manifest、统计信息或 compaction plan。后续若需要额外产物，必须重新进行架构对齐，而不是在 R1 返回值上追加隐藏字段。

## 4. 核心算法

### 4.1 顺序扫描

按 `items` 原始顺序扫描，维护一个仅用于本次调用的 phase（idle / collecting calls / collecting results）和 pending tool call 集合：

1. `UserMessage`：若不存在未完成 tool call，产生一个 `Role::User` 文本消息；若有未完成 call，返回顺序错误。
2. `AssistantMessage`：若不存在未完成 tool call，产生一个 `Role::Assistant` 并复制原始 blocks；若有未完成 call，返回顺序错误。
3. 连续 `ToolCall`：在 `idle` 或 `collecting calls` phase 中合并为同一个 `Role::Assistant` 消息，每个 item 生成一个 `ContentBlock::ToolUse` 并登记 pending identity；处于 `collecting results` phase 时出现新的 `ToolCall`，返回顺序错误。这样同一 multi-call round 内可以有多个 call，但不会开启第二个未闭合 round。
4. 连续 `ToolResult`：从 `collecting calls` 切换到 `collecting results`，之后合并为同一个 `Role::User` 消息；每个 result 必须消费一个此前 pending 的 identity。同一 round 内可以按实际完成顺序到达，但一个 result 段必须耗尽上一段 call 的全部 pending entries，否则返回错误；pending 清空后回到 `idle`，下一段 ToolCall 才能开启新 round。
5. `CheckpointCreated`：忽略其 metadata，不生成 message，也不刷新当前 call/result 聚合缓冲；它对模型消息分组透明。
6. `Compaction`：R1 立即返回错误，不猜测 excluded ids、summary 或 token 字段的模型语义。

扫描结束时 pending 集合必须为空，否则返回 dangling tool call 错误。

连续段的聚合是语义要求，不是输出优化：provider message boundary 由 context 统一决定，不能让各个 llm adapter 再自行修补。

### 4.2 ToolCall 映射

```text
ToolCall.tool_use_id → ContentBlock::ToolUse.id
ToolCall.name        → ContentBlock::ToolUse.name
ToolCall.input       → ContentBlock::ToolUse.input
```

`input` 保持 JSON 值语义，只做必要 clone，不 stringify。

### 4.3 ToolResult 映射

```text
ToolResult.tool_use_id → ContentBlock::ToolResult.tool_use_id
ToolResult.content     → ContentBlock::ToolResult.content
```

内容转换为：

```text
ToolContent::Text(text) → ToolResultContent::Text(text)
ToolContent::Json(value) → ToolResultContent::Text(compact_json(value))
```

当前 `llm::protocol::ContentBlock::ToolResult` 没有 status/name 字段，因此 `ToolResultStatus` 和 name 不伪造为模型 block 字段。status 由 loop 决定是否继续、重试或终止；context 只负责验证 name 与 pending call identity 一致，并把 result content 交给模型。

### 4.4 配对校验

pending identity 至少包含 `tool_use_id` 与 call name。以下情况必须返回 `anyhow::Error`：

- 同一 pending 集合中重复的 `tool_use_id`；
- result 的 `tool_use_id` 没有对应 call；
- result name 与对应 call name 不一致；
- 一个 result 被重复消费；
- 扫描结束仍有 pending call；
- pending call 未结束时出现普通 user/assistant message；
- `Compaction` 出现在任何位置。

错误应包含 item 类型和相关 id/name，便于 turn 边界诊断；不吞错、不自动补全、不写回 session。

## 5. import 边界

允许：

```text
context ──► session       # 读取 SessionItem
context ──► llm::protocol # 生成 Message / ContentBlock
context ──► tools         # 读取 canonical ToolCall / ToolResult / ToolContent
```

禁止：

```text
context ──X──► model_input / loop / agent / cli
context ──X──► session store write APIs
context ──X──► provider adapter / HTTP / IPC
```

`loop` 是上层调用者；它负责调用顺序、permission/approval 和 tool 执行，并把 materialize 结果交给 `model_input::compile`。context 只要求下一次 model Step 前当前 round 的 call/result 已全部配对。Loop R1 已确认先记录全部 calls、顺序执行并全量配对；并发、资源 claim、deadline 与 tool retry 后置给 scheduler。`model_input` 不反向 import context。

## 6. 不变量

1. 输出 message 顺序与输入 item 的语义顺序一致；
2. 每个 `ToolCall` 最多生成一个 `ToolUse` block；
3. 每个 `ToolResult` 恰好消费一个同 id、同 name 的 pending call；
4. 连续 call/result 段各自只生成一个 message；
5. `CheckpointCreated` 不改变模型可见消息；
6. R1 不静默丢弃 `Compaction`；
7. 函数只读输入，不产生 session/event/file 副作用；
8. R1 保留 session 语义边界，连续同 role 的 `Message` 是合法输出；provider wire 的角色交替/合并由 `llm` adapter 负责；
9. 相同输入产生相同输出或相同错误类别，不依赖全局状态。

## 7. 边界情况

| 输入 | R1 行为 |
|---|---|
| 空 Session Item Log | 返回空 `Vec<Message>` |
| 空 user text | 保持 session 层已有校验边界；context 不替换文本 |
| 单个普通 assistant message | 原样复制其合法 blocks |
| 多个连续 tool calls | 一个 assistant tool-use message |
| 多个连续 tool results | 一个 user tool-result message |
| checkpoint 位于普通消息之间 | 忽略 checkpoint，保持其他消息顺序 |
| checkpoint 位于连续 call/result 段内部 | 不刷新聚合缓冲，保持同一 call/result message 分组 |
| compaction item | 返回错误 |
| tool result 先于 call | 返回未知 identity 错误 |
| call 无 result | 扫描结束返回 dangling call 错误 |
| 上一 call 段未闭合又出现新 call 段 | 返回顺序错误 |
| JSON tool content | 序列化为紧凑文本；序列化错误上抛 |

## 8. 决策记录

| 决策 | 理由 |
|---|---|
| 使用 `materialize` | 与项目术语一致，明确是 Session Item Log 到模型消息的唯一出口 |
| 只返回 `Vec<Message>` | R1 只解决消息语义，不提前锁定 manifest/预算/compaction 内部结构 |
| 连续 call/result 聚合 | provider message boundary 是 context 语义，不应分散到 adapter |
| checkpoint 忽略、compaction 报错 | checkpoint 只有 metadata；compaction 需要真实策略，不能静默丢失 |
| status 不写入 ToolResult block | 当前协议 block 没有 status 字段；控制语义归 loop，避免伪造 provider 字段 |
| 读借用而非消费 SessionItem | context 只读 materialize，不取得事实源所有权，也不制造写入路径 |
| Message 转换由 llm adapter 持有 | context 只生成 MoonTide canonical Message；provider wire 字段、角色合并和请求 envelope 属于 llm adapter |
| 不引入 context trait | R1 只有一个确定的纯函数边界，尚无独立实现或动态装配需求 |

## 9. 实现分期

### R1

- 实现 `materialize`；
- 覆盖普通消息、连续 tool call/result、checkpoint、compaction error 与配对错误；
- 保持 `pub(crate)` 入口和 `Vec<Message>` 返回值；
- 通过 `just check` 后停在用户 diff review。

### R2（未设计）

compaction、窗口、summary、retrieval、manifest 或预算若出现真实消费者，重新进行 context 架构对齐；不得从 R1 的私有 helper 直接演化出未经确认的公共契约。

## 10. 单测方向

实现阶段至少覆盖：

1. 普通 user/assistant item 的角色与内容映射；
2. 连续 tool calls 聚合为单个 assistant message；
3. 连续 tool results 聚合为单个 user message；
4. text/json tool content 的转换；
5. checkpoint 被忽略且不改变顺序；
6. compaction 明确返回错误；
7. 重复 call、未知 result、name mismatch、重复 result、dangling call 均被拒绝；
8. 上一 call 段未闭合时出现新 call 段被拒绝；
9. checkpoint 位于 call/result 段内部时不改变聚合分组；
10. 输入切片保持不变，materialize 不写 session 或其他外部状态；
11. import 边界通过静态检查或等价结构守门：context 只依赖 session、llm protocol 与 tools，不依赖 model_input、loop、agent 或 cli。

每个 `#[test]` 前必须写中文注释，明确测试场景、预期结果以及不变量/副作用约束；测试只验证 context 拥有的语义，不把 loop permission 或 llm preflight 混入本模块。

---

<a id="loop"></a>

## loop

## 1. 职责与边界

`loop` 兑现四项承诺：

1. 独占持有一个 Session 的运行时依赖；
2. 把一次 `TurnInput` 编排为有界 Step 状态机；
3. 在 LLM、tool、event、session 之间维持持久化顺序与错误配对；
4. 统一处理 R1 的 LLM retry 与 Turn cancellation。

| 做 | 不做 |
|----|------|
| Session → Turn → Step → Tool round 编排 | provider preset、CLI 交互 |
| ToolPermissionMap 查询与 Ask 交互 | 把 permission 放进 ToolSpec |
| `context::materialize` / `model_input::compile` 调用 | context shaping、provider wire 编码 |
| LLM retry、Turn cancellation | tool 自动 retry、资源调度 |
| 通过 event 同步 commit Session 事实 | 直接调用 `SessionStore::commit_item` |
| 失败后维持 tool call/result 闭合 | 回滚 append-only 事实 |

领域层级固定为：

```text
Session 1 ── N Turn
Turn    1 ── 1..max_steps Step
Step    0 ── 1 Tool round
Tool round 1 ── 1..N ToolCall / ToolResult pairs
```

LLM retry attempt 是 Step 的内部传输尝试，不是新的领域层级。Run 不属于该模型。

---

## 2. 模块结构（目标）

```text
loop/
  README.md
  DESIGN.md
  GitHub Issues                 # 实现阶段由 batch-implement 生成
  mod.rs                   # re-export 跨 crate API
  agent_loop.rs            # AgentLoop / AgentLoopInit / turn 入口
  turn.rs                  # TurnInput / TurnPolicy / 主状态机
  tool_runtime.rs          # permission / approval / ToolRuntime
  response.rs              # ModelResponse 分类与 block 拆分
  retry.rs                 # LLM retry 与固定 backoff
  cancellation.rs          # 私有 select/cleanup helper；不定义公共 wrapper
  tests.rs
```

文件可在实现时按 review 批微调，但不能把 SessionStore、provider adapter、tool executor 或 Hook 实现吸收到 loop。

---

## 3. 类型与完整签名

### 3.1 `AgentLoopInit` / `AgentLoop`

```rust
pub struct AgentLoopInit {
    pub session: crate::session::SessionStore,
    pub provider: std::sync::Arc<dyn crate::llm::LLMProvider>,
    pub tools: ToolRuntime,
    pub events: crate::event::EventDispatcher,
}

pub struct AgentLoop {
    session: crate::session::SessionStore,
    provider: std::sync::Arc<dyn crate::llm::LLMProvider>,
    tools: ToolRuntime,
    events: crate::event::EventDispatcher,
}

impl AgentLoop {
    pub fn new(init: AgentLoopInit) -> Self;

    pub async fn turn(
        &mut self,
        input: TurnInput,
        cancellation: tokio_util::sync::CancellationToken,
    ) -> anyhow::Result<crate::llm::protocol::ModelResponse>;
}
```

`AgentLoop` 不实现 `Clone`。`turn(&mut self)` 是同一实例的串行门；它不提供取得内部 `SessionStore`、替换 registry 或更换 hooks 的运行时 setter。

### 3.2 `TurnInput` / `TurnPolicy`

```rust
pub struct TurnInput {
    pub text: String,
    pub config: crate::model_input::ModelRequestConfig,
    pub system_prompt: crate::model_input::SystemPrompt,
    pub policy: TurnPolicy,
}

pub struct TurnPolicy {
    pub max_steps: u32,
    pub max_llm_retries: u32,
}

impl TurnPolicy {
    pub fn new(max_steps: u32) -> anyhow::Result<Self>;
}
```

常量为 loop 私有实现细节：

```rust
const DEFAULT_MAX_LLM_RETRIES: u32 = 3;
const LLM_RETRY_BACKOFFS: [std::time::Duration; 3] = [
    std::time::Duration::from_millis(500),
    std::time::Duration::from_secs(1),
    std::time::Duration::from_secs(2),
];
```

R1 只允许 `max_llm_retries` 在 `0..=3` 范围内；默认值为 3。超过 3 在 `TurnPolicy::new` 或 `turn()` 入口拒绝，不为更大的 retry 次数扩展 backoff 配置。`turn()` 必须再次拒绝 `max_steps == 0`，因为字段公开供组合根配置。

### 3.3 Permission / approval / `ToolRuntime`

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPermission {
    Allow,
    Ask,
}

pub type ToolPermissionMap =
    std::collections::BTreeMap<String, ToolPermission>;

pub enum ToolApproval {
    Approved,
    Denied { reason: String },
    Cancelled,
}

pub trait ToolApprovalHandler: Send + Sync {
    fn request<'a>(
        &'a self,
        call: &'a crate::tools::ToolCall,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = anyhow::Result<ToolApproval>> + Send + 'a>,
    >;
}

pub struct ToolRuntime {
    registry: crate::tools::ToolRegistry,
    permissions: ToolPermissionMap,
    approval: Option<std::sync::Arc<dyn ToolApprovalHandler>>,
}

impl ToolRuntime {
    pub fn new(
        registry: crate::tools::ToolRegistry,
        permissions: ToolPermissionMap,
        approval: Option<std::sync::Arc<dyn ToolApprovalHandler>>,
    ) -> anyhow::Result<Self>;
}
```

构造校验：

1. registry names 与 map keys 完全一致；
2. 存在任一 `Ask` 时 `approval.is_some()`；
3. 无 `Ask` 时允许保留 handler，但 loop 不调用；
4. 运行时 lookup 意外 miss 仍映射 `Denied`。

`ToolRuntime` 是 loop 的装配聚合，不是新工具执行层。resolve、validate、execute 仍调用 `tools` 模块现有能力。

### 3.4 Session 接缝

R1 在 `session` 增加 crate-private cursor：

```rust
impl SessionStore {
    pub(crate) fn next_turn(&self) -> anyhow::Result<u64>;
}
```

算法：empty → 0；否则读取最后一条 item 的 turn，`checked_add(1)`；溢出返回错误。该函数只读，不预占编号。编号在 `UserPromptCommitted` commit 成功后才事实上被消费。

`SessionStore` 直接实现 event 的 mutable commit seam：

```rust
impl crate::event::CommitHandler for SessionStore {
    fn commit(
        &mut self,
        event: &crate::event::TurnEvent,
    ) -> anyhow::Result<Option<String>>;
}
```

这替代当前拥有 `Mutex<SessionStore>` 的 `SessionCommitHandler`。EventDispatcher 不拥有 store；AgentLoop 每次 emit 时借出 `&mut self.session`。

---

## 4. Agent 装配与所有权

```text
agent:
  session = create | load | fork
  provider = build_provider(...)
  registry = ToolRegistry::new(...)
  tools = ToolRuntime::new(registry, permissions, approval)
  events = EventDispatcher::new(PipelineRegistry::builder().hook(...).build_frozen(), trace)

  AgentLoop::new(AgentLoopInit { session, provider, tools, events })
```

所有权不变量：

1. AgentLoop 构造后，组合根不保留第二个 SessionStore writer；
2. SessionStore 不要求 Clone，也不通过 `Arc<Mutex<_>>` 共享；
3. EventDispatcher 只在 `emit` 调用期间借用 mutable commit handler；
4. hook 只收到不可变 event/context，不能取得 SessionStore；
5. R1 不做文件 lease；同时 load 同一 session 的多个独立 AgentLoop 是调用方违规。

---

## 5. Turn 主状态机

```text
turn(input, cancellation):
  validate input + policy
  cancellation checkpoint

  # preflight on existing facts
  context::materialize(session.items())?
  turn = session.next_turn()?

  cancellation checkpoint
  emit(TurnStarted { turn }, &mut session)?       # observational only
  emit(UserPromptCommitted { turn, text }, &mut session)?

  for step in 0..policy.max_steps:
    messages = context::materialize(session.items())?
    request = model_input::compile(
      &input.config,
      &input.system_prompt,
      messages,
      tools.registry,
    )

    response = call_llm_with_retry(step, request, policy, cancellation)?
    action = classify_response(response)?

    match action:
      Terminal { assistant_blocks, response }:
        emit AssistantFinalized
        emit TurnEnded
        return response

      ToolRound { assistant_blocks, calls, response }:
        emit AssistantFinalized once; empty blocks for tool-only response are not committed
        commit all ToolCallRecorded
        process all calls sequentially and commit all results
        if step is last permitted step:
          emit TurnEnded
          return Err(max steps exhausted after closed tool round)

  unreachable after max_steps validation
```

`TurnStarted` 先于 UserPromptCommitted，延续当前 Agent Event 生命周期语义，但它只是 observational。UserMessage 的正确性只取决于后续 commit；若 commit 失败，Agent Event 可以出现一个没有事实写入的失败 Turn 观察记录。任何 preflight 失败或已触发的 cancellation 都发生在 TurnStarted 前，且不得消费 turn number。

错误路径按需 emit `TurnEnded` 只属于观测策略，不形成 Session 完成事实。R1 不增加 `TurnFailed` / `TurnCompleted` SessionItem。

---

## 6. Response 分类算法

输入：完整 `ModelResponse`。先一次遍历 `content`：

```text
assistant_blocks = Text + Thinking（保持原顺序）
tool_blocks      = ToolUse（保持原顺序）
invalid          = ToolResult
```

规则：

| stop reason | tool_blocks | 结果 |
|-------------|-------------|------|
| `ToolUse` | empty | `Err`；不执行工具 |
| `ToolUse` | non-empty | `ToolRound` |
| `EndTurn` / `MaxTokens` / `Other` | empty | `Terminal` |
| `EndTurn` / `MaxTokens` / `Other` | non-empty | `Err`；stop reason 与 payload 矛盾 |
| any | contains `ToolResult` | `Err`；模型不能生成 host result |

`ToolCall::new` 为每个 ToolUse 再守门 id/name/input。任何 call 身份无效时，当前 response 不进入副作用阶段。因为所有 calls 必须先成功构造并整体记录，不能在解析到一半后执行前几个工具。

ToolUse response 的 `ModelResponse` 不作为 `turn()` 终值。Terminal response 原样返回，保留 stop reason、usage 和 model。

---

## 7. LLM Step 与 retry

### 7.1 attempt 时序

```text
request = compile once for this Step

for attempt in 0..=max_llm_retries:
  llm_call_id = new id
  emit LlmCallStarted(turn, step, llm_call_id)

  select:
    cancellation.cancelled() → cancel Turn
    run_model_call_with_updates(provider, request.clone(), on_update) → result

  success:
    classify response shape
    emit LlmCallEnded(Succeeded { stop_reason, usage })
    emit AssistantFinalized once after the successful response is accepted
    continue terminal/tool-round handling

  invalid response shape:
    emit LlmCallEnded(Failed { InvalidResponse })
    return error

  request failure or cancellation:
    emit LlmCallEnded(Failed/Cancelled)
    retry only recoverable request failures while attempts remain

  RequestFailed(Recoverable) and attempts remain:
    cancellation-aware backoff
    continue with same request and same step

  other error or exhausted:
    return original last error
```

`ModelRequest` 在同一 Step 内保持字节语义等价；attempt 不重新 materialize/compile，防止 retry 期间 Session 或工具集合漂移。每个 attempt 有独立 `llm_call_id`，每个 attempt 恰好有一个 `LlmCallEnded`。流式 partial snapshot 只作为 Agent Event / progress 观测，不 commit AssistantMessage。

### 7.2 retry 分类

| 错误 | retry |
|------|-------|
| `RequestFailed { Recoverable }` | 是，直到上限 |
| `RequestFailed { Unrecoverable }` | 否 |
| provider `Cancelled` | 否 |
| event/session/hook/tool 错误 | 否 |

R1 不为 retry 新增 `LlmCallFailed` / `RetryScheduled` TurnEvent：失败 attempt 可能只有 `LlmCallStarted` 与 partial MessageUpdate，下一次新 llm_call_id 的 Started 表示重试。更完整的失败/span 观测等 observability 接入时统一设计，不得因此增加 SessionItem 或改变 Step 数。

---

## 8. Tool round 算法

### 8.1 先记录全部 calls

```text
calls = parse every ToolUse

for call in calls:
  emit ToolCallRecorded(call)  # sync commit; no tool side effect yet

for index, call in calls:
  result = process_one(call, cancellation)
  emit ToolResultRecorded(result)

  if fatal_error_or_cancel:
    for remaining in calls[index + 1..]:
      emit ToolResultRecorded(Cancelled { Parent })
    return after all pairs committed
```

如果记录任一 ToolCall 时 commit 失败，没有工具被执行；错误立即向上返回。此前已记录的 calls 可能暂时 dangling，但这是 Session 持久化基础设施故障，不能通过继续副作用修复。正常/取消/executor 错误路径必须闭合全部已记录 calls。

### 8.2 单 call 决策

```text
registry.resolve(name)
  missing → UnknownTool

registry.validate_input(tool, call)
  invalid → InvalidArguments

permissions.get(name)
  missing → Denied
  Allow   → execute
  Ask     → await approval with cancellation
              Approved → execute
              Denied   → Denied
              Cancelled → Cancelled(User), abort round
              Err       → Cancelled(Disposed), abort round with error

execute with cancellation select
  completed Ok(result) → result
  completed Err(error) → OutcomeUnknown, abort round with original error
  token cancelled      → OutcomeUnknown, abort round with cancellation error
```

在调用 executor future 前发现 cancellation，当前 call 是 `Cancelled { User }`；一旦 future 已开始 poll，取消时副作用无法确认，当前 call 必须是 `OutcomeUnknown`。

`ToolResultStatus::Failed { retryable }` 在 R1 只作为模型可见结果提交，不触发 loop 自动重试。未来 scheduler 可以基于该字段设计策略，但不得让同一个 ToolCall 产生多个 ToolResult。

---

## 9. Cancellation 状态机

公开能力只有调用方提供的 `CancellationToken`。私有实现可以使用 cancellation-safe `tokio::select!`，但不得增加公共 wrapper。

| 取消时点 | Session 结果 | Turn 结果 |
|----------|--------------|-----------|
| UserMessage commit 前 | 无新 item，不消费 turn | cancel error |
| LLM attempt / backoff | UserMessage 保留，无 assistant partial | cancel error |
| approval 等待 | 当前 `Cancelled(User)`，剩余 `Cancelled(Parent)` | cancel error |
| tool 执行开始前 | 当前 `Cancelled(User)`，剩余 `Cancelled(Parent)` | cancel error |
| tool future 已开始 | 当前 `OutcomeUnknown`，剩余 `Cancelled(Parent)` | cancel error |
| Terminal assistant commit 完成后 | final response 已赢得竞争 | `Ok(ModelResponse)` |

清理规则：

1. 所有已 commit 的 ToolCall 必须得到一个 ToolResult；
2. cleanup commit 不受已经触发的 token 再次中断；
3. cleanup commit 失败时返回 commit error，并保留原 cancel/error 作为上下文；
4. cancellation 后只要 `context::materialize` 接受现有事实，AgentLoop 可执行下一 Turn；
5. drop future 不在契约内，调用方必须 cancel 后 await。

`LlmError::CancelReason` 与 `ToolCancellationReason` 是当前低层/持久化协议；R1 loop 不新增同义 `TurnCancelReason`。Hook 不能触发取消，因此 loop 不生产 Hook reason。

---

## 10. Event / Hook / commit 接缝

Loop R1 依赖 event 的同步目标契约：

```rust
pub trait CommitHandler {
    fn commit(&mut self, event: &TurnEvent) -> anyhow::Result<Option<String>>;
}

pub trait HookHandler: Send + Sync {
    fn on_event(
        &self,
        ctx: &TraceContext,
        event: &TurnEvent,
    ) -> anyhow::Result<()>;
}

impl EventDispatcher {
    pub fn emit(
        &mut self,
        commit: &mut dyn CommitHandler,
        event: TurnEvent,
    ) -> anyhow::Result<()>;
}
```

Pipeline 顺序：

```text
Committable: commit → hook*（全部 fail-open）→ optional observer bridge
Observational: hook*（全部 fail-open）→ optional observer bridge
```

- `PipelineRegistry` 只冻结 hooks；不拥有 commit；
- `SessionStore` 直接实现 `CommitHandler`；
- 原 `ObserveHandler` 合并进 post-commit `HookHandler`；
- 原 `HookOutcome::Block` 删除；Hook 不能改变 loop 决策；
- Agent Event derive/recorder 由 `DeriveAgentEventHook` 保留；
- hook 错误被诊断并继续调用后续 hook，`emit` 只传播 commit 正确性错误。
- 每次 emit 开始清理 `session_item_id`、`tool_use_id`、`llm_call_id`，再从当前 event 填充 transient correlation fields。

这部分是 loop 实现的前置 event 接缝批，不得把 AgentEvent schema、storage、file writer 一并删除或改名。

---

## 11. import 边界

```text
loop → session::SessionStore（持有 + items/next_turn + mutable commit seam）
loop → context::materialize
loop → model_input::{compile, ModelRequestConfig, SystemPrompt}
loop → llm::{LLMProvider, run_model_call_with_updates, protocol}
loop → tools::{ToolRegistry, ToolCall, ToolResult, status}
loop → event::{TurnEvent, EventDispatcher, CommitHandler}
loop → tokio-util::CancellationToken

agent → loop public assembly API
cli   → agent（不直接装配 loop）

session / context / model_input / llm / tools / event ↛ loop
```

`loop` 不 import `agent-tools`、provider adapter、CLI 或文件 recorder 实现。`tokio-util` 仅在开始实现时加入依赖，本轮文档不修改 Cargo.toml。

---

## 12. 不变量

### Ownership

1. 一个 AgentLoop 独占一个 SessionStore；
2. `turn(&mut self)` 保证同实例 Turn 串行；
3. EventDispatcher 不长期拥有 SessionStore；
4. AgentLoop 不 Clone；R1 不声称跨实例并发安全。

### Turn / Step

5. 执行层级只有 Session → Turn → Step → Tool round；
6. 调用者不提供 turn number；UserMessage commit 后编号不复用；
7. Step 从 0 开始，最多 `max_steps` 个；retry 不增加 Step；
8. 同一 Step 的 retry 使用相同 ModelRequest、不同 llm_call_id；
9. Terminal ModelResponse 原样返回，不增加重复 outcome wrapper。

### Session

10. 新 UserMessage 前必须先 materialize 已有事实；
11. loop 不直接 `commit_item`，所有运行时写入经 TurnEvent commit；
12. Turn 错误不回滚已提交事实；
13. R1 不写 TurnCompleted/TurnFailed item。

### Tool round

14. 所有 ToolCall 在任何副作用前完成 commit；
15. call/result 保持模型顺序；R1 顺序执行；
16. 下一 Step 前 round 全量闭合；
17. 每个 ToolCall 恰好一个 ToolResult；
18. executor Err / 执行中取消先写 `OutcomeUnknown`，再传播；
19. fatal/cancel 后未开始 calls 写 `Cancelled(Parent)`；
20. 最后允许 Step 的 ToolUse 仍先闭合 round，再报 step exhaustion。

### Extension

21. Hook 只做 post-commit callback，不能 block/approve/cancel/retry；
22. Hook error fail-open，不改变 Turn 返回值；
23. permission、approval、cancel、retry 均为显式 loop API/状态机。

---

## 13. 边界情况

| 场景 | 处理 |
|------|------|
| 空 user text | `turn()` 入口 `Err`，不 append |
| `max_steps == 0` | `Err`，不 append |
| 已有 dangling tool round | preflight `materialize` → `Err`，不 append |
| next turn 溢出 | `Err`，不 append |
| stop=ToolUse 但无 ToolUse block | `Err`，不执行工具 |
| terminal stop 含 ToolUse | `Err`，不执行工具 |
| 模型产生 ToolResult block | `Err` |
| call 解析中有一个非法 identity | 整个 round 不记录、不执行 |
| commit all calls 中途失败 | 无工具执行；传播 commit error |
| unknown/invalid/denied/expected tool failure | commit result，继续处理 round |
| approval Cancelled | 当前 User、剩余 Parent，闭合后取消 |
| approval handler Err | 当前 Disposed、剩余 Parent，闭合后传播 |
| executor Err | 当前 OutcomeUnknown、剩余 Parent，闭合后传播 |
| final Step 返回 ToolUse | 闭合 round 后返回 max-step error |
| retry backoff 时取消 | 立即取消，无新 SessionItem |
| final commit 与 cancel 同时 ready | commit 成功的 terminal response 优先 |

---

## 14. 决策记录

1. 删除冗余 Run；观测 trace identity 不等于执行实体；
2. AgentLoop 长期持有 SessionStore，`turn(&mut self)` 串行化同实例；
3. R1 不为理论第二写者增加 OS lease；
4. AgentLoop 用单个 `AgentLoopInit` 接收运行时所有权，避免 constructor 参数膨胀；
5. R1 返回 `ModelResponse`，不增加 `RunResult` / `TurnOutcome`；
6. caller 不传 turn number，由 SessionStore 只读计算 next turn；
7. UserMessage commit 是 turn number 的消费点，事实不回滚；
8. Step 是逻辑 LLM 调用，retry attempt 不增加 Step；
9. `max_steps` 必填，最后 Step 的 ToolUse 必须先闭合 round；
10. 默认 LLM retry 是初次后的 3 次，仅 Recoverable，固定 cancellation-aware backoff；
11. 直接使用 `CancellationToken`，不建立 `TurnCancellation` wrapper；
12. drop future 不是取消协议，cancel 后必须 await cleanup；
13. permission 是 ToolRuntime 内的声明式 map，Ask 经显式 approval port；
14. 一个 response 的所有 ToolCall 先 commit，再按顺序执行；
15. executor Err / 执行中取消用 OutcomeUnknown，未开始 sibling 用 Parent cancellation；
16. Hook 是 post-commit extension callback，不是决策链；
17. Event commit handler 按 emit 借用，SessionStore 直接实现 mutable seam；
18. follow-up/steering、多 Turn Run、scheduler、OTel 和 lease 后置。

---

## 15. 实现分期

| 批 | 范围 |
|----|------|
| **R1-A** | event 接缝：post-commit Hook、borrowed mutable CommitHandler、保留 AgentEvent 适配器 |
| **R1-B** | session `next_turn`、直接 CommitHandler 实现、移除 SessionCommitHandler |
| **R1-C** | loop 公共类型、AgentLoop ownership、terminal no-tool Turn |
| **R1-D** | ToolRuntime、permission/approval、顺序 Tool round 与配对错误路径 |
| **R1-E** | LLM retry、CancellationToken、cleanup 竞争语义 |
| **R1-F** | 跨模块 conformance、文档状态与组合根接缝 |

实现开始前由 `batch-implement` 生成 `GitHub Issues`，逐批 review。任何公开签名变化必须回到架构对齐，不能在实现批静默调整。

---

## 16. 单测方向

- AgentLoop 非 Clone、SessionStore 只存在一个 runtime owner；
- empty / resumed session 的 next_turn、checked overflow；
- preflight dangling round 拒绝且不写 UserMessage；
- UserMessage commit 后错误不回滚且下一 Turn 编号递增；
- Step 从 0 递增，retry 保持 Step/request 且更换 llm_call_id；
- 只重试 Recoverable，默认总 attempt 数为 4，backoff 可被 cancellation 中断；
- StopReason 与 block shape 的完整矩阵；
- ToolUse 响应先记录全部 calls，再发生第一个副作用；
- unknown → invalid → permission → execute 的拒绝顺序与未调用副作用断言；
- Ask Approved/Denied/Cancelled/handler Err 全分支；
- executor Err、执行中取消和剩余 sibling 的状态、顺序与原错误传播；
- final permitted Step 返回 ToolUse 时 round 闭合且没有下一 LLM call；
- Hook 在 commit 后运行、全部 fail-open、不能改变 Turn 结果；
- final commit 与 late cancellation 的成功优先；
- cancellation cleanup 后 session 可 materialize，AgentLoop 可运行下一 Turn；
- import/conformance：低层模块不反向依赖 loop，loop 不 import agent/agent-tools/adapter。

---

<a id="scheduler"></a>

## scheduler

> **状态：** 后置；由真实资源调度需求触发。

分诊、fan-out、delegate、排队、并发 ToolExecutor、tool retry 与 offload。依赖 `llm` + `tools`；不插入单次 tools 门禁。详见 [`crates/docs/agent-core.md`](../docs/agent-core.md) §2 与 [`README.md`](README.md) checklist。

