# loop

> **对外使用说明** — 集成 `agent-core::loop` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)。
> **状态：** R1/R2/R3 已提交；TASK-loop-06 conformance 收尾尚未完成。
> **关联：** [`../session/README.md`](../session/README.md) · [`../event/README.md`](../event/README.md) · [`../tools/README.md`](../tools/README.md) · [`../llm/README.md`](../llm/README.md)

---

## 这是什么

`loop` 是一次用户交互的**编排边界**。它长期持有一个 Session 的运行时依赖，并把一次 `turn()` 串成：

```text
Session → Turn → Step → Tool round
```

- **Session**：跨多个 Turn 的 append-only 事实源；
- **Turn**：一次用户输入到一个终止 `ModelResponse` 或错误；
- **Step**：一次逻辑 LLM 调用；同一 Step 内可以重试；
- **Tool round**：某个 ToolUse 响应中的全部 tool calls 及其配对结果。

R1 不引入 Run 执行实体。Agent Event 中遗留的 `runId` 只是观测分区键，不参与 `turn()` 的身份、取消、恢复或返回值。

---

## 设计原理（brief）

```text
agent（组合根）
  create / load / fork Session
  build provider + tools + hooks
            │ 一次性转移所有权
            ▼
      AgentLoop::new(AgentLoopInit)
            │
            ├─ turn(input, cancellation)
            │    ├─ preflight materialize
            │    ├─ commit UserMessage
            │    ├─ Step 0: compile → LLM
            │    ├─ Tool round? → record all calls → sequential results
            │    └─ Step N: compile → LLM → terminal response
            │
            └─ 同一实例的下一次 turn
```

`AgentLoop` 对 SessionStore 使用独占所有权，`turn(&mut self, ...)` 保证同一实例内不会并发执行两个 Turn。R1 不增加 OS 文件锁或跨实例 lease；同一 session 同时被两个独立 AgentLoop 加载并写入属于不支持用法。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`agent`** | 构造 `AgentLoopInit`、`ToolRuntime`，创建 `AgentLoop` | 复制 Turn 状态机、在运行中取回 SessionStore |
| **`cli`** | 通过 `agent` 调 `turn()`，持有并触发 `CancellationToken` | 直接写 Session、把 drop future 当成正式取消 |
| **`loop`** | 调用 `context::materialize`、`model_input::compile`、LLM/tools/event 接缝 | provider preset、第一方工具 catalog、文件观测格式 |
| **`session`** | 作为 loop 私有事实源与 event commit 目标 | 反向依赖 loop |
| **`scheduler`** | R1 不参与；后续接管多调用资源调度 | 改写 Turn/Step 语义 |
| **测试** | 注入 provider、tool、approval、hook 替身 | 依赖真实网络或 shell 验证状态机 |

---

## 公开 API 速查

### AgentLoop 的一次性装配

```rust
pub struct AgentLoopInit {
    pub session: SessionStore,
    pub provider: std::sync::Arc<dyn LLMProvider>,
    pub tools: ToolRuntime,
    pub events: EventDispatcher,
}

pub struct AgentLoop {
    // private runtime ownership
}

impl AgentLoop {
    pub fn new(init: AgentLoopInit) -> Self;
}
```

`AgentLoopInit` 只表达构造时的所有权转移，不是每 Turn 传递的 runtime context，也不在运行中保存第二份可变句柄。

### Turn 输入与策略

```rust
pub struct TurnInput {
    pub text: String,
    pub config: ModelRequestConfig,
    pub system_prompt: SystemPrompt,
    pub policy: TurnPolicy,
}

pub struct TurnPolicy {
    pub max_steps: u32,
    pub max_llm_retries: u32,
}

impl TurnPolicy {
    pub fn new(max_steps: u32) -> anyhow::Result<Self>;
}

impl AgentLoop {
    pub async fn turn(
        &mut self,
        input: TurnInput,
        cancellation: tokio_util::sync::CancellationToken,
    ) -> anyhow::Result<ModelResponse>;
}
```

`TurnPolicy::new(max_steps)` 拒绝 `max_steps == 0`，并把 `max_llm_retries` 默认设为 **3**。这里的 3 是初次请求后的重试次数，因此单个 Step 最多发起 4 次 LLM attempt。R1 只允许 `max_llm_retries` 为 `0..=3`；`turn()` 入口仍验证 policy，避免调用者用字段构造非法值。

R1 直接返回最终 `ModelResponse`，不增加 `RunResult` 或 `TurnOutcome`。错误和取消通过 `anyhow::Result` 到 Turn 边界。

### 工具运行时与 permission

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
        call: &'a ToolCall,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = anyhow::Result<ToolApproval>> + Send + 'a>,
    >;
}

pub struct ToolRuntime {
    // private: registry + permissions + approval
}

impl ToolRuntime {
    pub fn new(
        registry: ToolRegistry,
        permissions: ToolPermissionMap,
        approval: Option<std::sync::Arc<dyn ToolApprovalHandler>>,
    ) -> anyhow::Result<Self>;
}
```

构造器要求 registry 与 permission map 的 key 集完全一致；存在 `Ask` 时必须注入 approval handler。运行时 permission 缺失仍安全返回 `Denied`，不能默认允许。禁用工具从 registry 移除，不增加 `Deny` 配置值。

---

## 一次 Turn 的承诺

```text
1. 若 cancellation 已触发，直接取消，不消费 turn number
2. materialize 已有 Session Item Log；损坏或 dangling round → Err，不 append
3. SessionStore::next_turn() 得到 turn number
4. emit UserPromptCommitted；commit 成功后该 turn 永久占用
5. 对 step = 0..max_steps：
   a. materialize 最新 log
   b. compile 同一个 Turn 的 config/system/tools
   c. 调 LLM；Recoverable 可在当前 Step 内重试
   d. 按 stop_reason 终止或完成一个 Tool round
6. 返回终止 ModelResponse，或在完成必要事实配对后返回 Err
```

Turn 失败不回滚 Session Item Log。下一次 `turn()` 会重新做 materialize preflight；只要事实仍合法闭合，同一个 AgentLoop 可以继续使用。

### Turn number

- 空 session 的第一个 Turn 是 `0`；最后一个 item 的 turn 为 `N` 时，下一个是 `N + 1`；
- 使用 checked add，溢出返回错误；
- 调用者不能传入 turn number；
- `UserPromptCommitted` 成功前的失败不消费编号；成功后即使 Turn 后续失败也不复用编号。

R1 不增加 `TurnCompleted` / `TurnFailed` SessionItem；恢复只以已提交事实为准。

---

## Step 与模型响应

一个 Step 是一次**逻辑**模型调用。初始 Step 为 0；同一请求的 retry attempt 不增加 Step，也不重新 `compile`，但每次 attempt 使用新的 `llm_call_id`。

| `StopReason` | R1 行为 |
|--------------|---------|
| `ToolUse` | 必须至少含一个 `ToolUse`；非 tool blocks 先作为 `AssistantFinalized` 提交（为空则跳过），随后按模型顺序提交全部 `ToolCall` 并完成 round |
| `EndTurn` | 响应不得含 `ToolUse`；提交 assistant blocks，返回原 `ModelResponse` |
| `MaxTokens` | 响应不得含 `ToolUse`；提交可用 assistant blocks，返回原 `ModelResponse` |
| `Other(_)` | 响应不得含 `ToolUse`；提交可用 assistant blocks，返回原 `ModelResponse` |

模型返回的 `ContentBlock::ToolResult` 在任何响应中都非法。`AssistantMessage` 不存 tool blocks；ToolUse 由独立 `ToolCall` SessionItem 表达。

若最后一个允许的 Step 返回 `ToolUse`，loop 仍必须完成并配对整个 Tool round，然后因不存在下一 Step 返回错误。不得为了满足 step limit 留下 dangling call。

---

## Tool round

R1 对一个 ToolUse 响应执行固定顺序：

```text
1. 按 response block 顺序提取全部 ToolCall
2. 在任何工具副作用前，依次 commit 全部 ToolCallRecorded
3. 按相同顺序逐个处理：
   resolve → validate input → permission → execute → commit ToolResultRecorded
4. 全部 call 均有且仅有一个 result 后，才允许下一 Step
```

映射规则：

- unknown tool → `UnknownTool`；
- invalid input → `InvalidArguments`；
- permission missing / denied → `Denied`；
- executor 预期失败 → 保留其 `Failed { retryable }`，R1 不自动重试；
- executor 基础设施 `Err` → 当前 call 记 `OutcomeUnknown`，剩余未开始 calls 记 `Cancelled { Parent }`，全部 commit 后传播原错误；
- approval 返回 `Cancelled` → 当前 call 记 `Cancelled { User }`，剩余 calls 记 `Cancelled { Parent }`，结束 Turn；
- approval handler 返回 `Err` → 当前 call 记 `Cancelled { Disposed }`，剩余 calls 记 `Cancelled { Parent }`，全部 commit 后传播错误。

---

## Retry 与取消

### LLM retry

- 只重试 `LlmError::RequestFailed { kind: Recoverable, .. }`；
- 默认 3 次 retry，固定 backoff：500 ms、1 s、2 s；
- 同一个 Step、同一个 `ModelRequest`，每次 attempt 新建 `llm_call_id`；
- 失败 attempt 不写 Session；流式 partial update 只进入 Agent Event；
- retry exhausted 返回最后一个原始 `LlmError`；
- tool、session、hook 不自动 retry。

### CancellationToken

R1 直接使用 `tokio_util::sync::CancellationToken`，不再包装 `TurnCancellation`，也不公开 `interrupt` / `TurnHandle` / cancel reason 结构。

- token 同时打断 LLM attempt、retry backoff、approval 等待和 tool future 等待；
- 工具尚未开始：当前 `Cancelled { User }`，后续 `Cancelled { Parent }`；
- 工具已经开始：当前 `OutcomeUnknown`，后续 `Cancelled { Parent }`；
- loop 先补齐 round 的所有结果，再返回取消错误；
- 最终响应已经成功 commit 时，晚到的取消不覆盖成功；
- 直接 drop `turn()` future 不保证 cleanup，调用方应先 `cancel()` 并继续 await。

Hook 不是取消源，也不能决定 retry、permission 或 Turn 控制流。

---

## 与相邻模块的接缝

| 模块 | loop 如何使用 | 所有权边界 |
|------|---------------|------------|
| `session` | 持有 `SessionStore`；读 `items()`；作为 event commit 目标 | loop 不直接 `commit_item` |
| `context` | 每次 preflight / Step 前调用 `materialize` | 只读，不写 session |
| `model_input` | 每 Step 调 `compile` | 不持久化 ModelRequest |
| `llm` | 只经 `run_model_call*` | retry/cancel policy 在 loop |
| `tools` | resolve、validate、execute 单次 call | permission 与多 call 顺序在 loop |
| `event` | emit TurnEvent；同步 commit 后运行 fail-open hooks | Hook 不改变决策 |
| `agent` | 创建全部依赖并一次性转移进 init | 不复制 loop 状态机 |

---

## R1 非目标

- 多 Turn Run、follow-up、steering；
- OS 级 Session lease 或跨进程并发写协调；
- tool 并行、资源 claim、deadline、scheduler/offload；
- tool 自动 retry；
- 可配置 backoff、jitter、`Retry-After`；
- compaction 策略；
- subagent；
- OTel trace/span 与 legacy `runId` 迁移；
- pause/resume 或额外 cancellation reason。

这些能力需要各自的真实 owner 和恢复语义，不能通过扩大 Hook 或把 Run 重新放回执行领域来隐式实现。

---

## 常见错误

| 做法 | 问题 |
|------|------|
| 每次 `turn()` 传 SessionStore / EventDispatcher | 破坏 AgentLoop 的运行时所有权，参数重新膨胀 |
| 为 trace 增加领域 Run | 观测 identity 与执行生命周期混淆 |
| retry 消耗新 Step | 把传输恢复误建模为新的模型决策 |
| 最后 Step 遇 ToolUse 直接返回 | Session 留下未配对 ToolCall |
| Hook 返回 Block / Approval | 扩展 callback 进入正确性与决策路径 |
| 取消时 drop future | 无法保证 ToolResult 配对与 Session 可恢复 |
| 两个 AgentLoop 同时 load 同一 session | R1 没有跨实例 lease，属于不支持用法 |

实现状态机、完整时序和测试矩阵见 [`DESIGN.md`](DESIGN.md)。
