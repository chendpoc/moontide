# loop — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** R1–R3 与 TASK-loop-06 已提交并通过测试；Loop 模块完成。
> **关联：** [`../session/DESIGN.md`](../session/DESIGN.md) · [`../event/DESIGN.md`](../event/DESIGN.md) · [`../tools/DESIGN.md`](../tools/DESIGN.md) · [`../llm/DESIGN.md`](../llm/DESIGN.md)

---

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
  TASKS.md                 # 实现阶段由 batch-implement 生成
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
        emit AssistantFinalized if blocks non-empty
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
    emit LlmCallEnded
    return response

  RequestFailed(Recoverable) and attempts remain:
    cancellation-aware backoff
    continue with same request and same step

  other error or exhausted:
    return original last error
```

`ModelRequest` 在同一 Step 内保持字节语义等价；attempt 不重新 materialize/compile，防止 retry 期间 Session 或工具集合漂移。每个 attempt 有独立 `llm_call_id`，流式 partial snapshot 只作为 Agent Event 观测，不 commit AssistantMessage。

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
Committable: commit → hook*（全部 fail-open）→ optional bus
Observational: hook*（全部 fail-open）→ optional bus
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

实现开始前由 `batch-implement` 生成 `TASKS.md`，逐批 review。任何公开签名变化必须回到架构对齐，不能在实现批静默调整。

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
