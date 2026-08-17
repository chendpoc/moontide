# tools

> **对外使用说明** — 集成 `agent-core::tools` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)。
> **状态：** RB1–RB2 已实现并完成 Review；单次调用与 typed 接缝已完成；Loop R1 ToolRuntime、permission/approval、顺序 round 与 cancellation 语义已实现。
> **关联：** [`../llm/README.md`](../llm/README.md) · [`../session/README.md`](../session/README.md) · [`../event/README.md`](../event/README.md)

---

## 这是什么

`tools` 是模型能力的**单次调用边界**。它不只是一个函数表，而是把下面几件事明确分开：

```text
ToolSpec        能力契约：模型能请求什么
ToolRegistry    能力目录：当前 step 暴露哪些实现
ToolCall        一次模型请求
ToolExecutor    真实副作用的唯一执行端口
ToolResult      单次调用的规范化结果
```

`tools` 负责「能力是什么、如何找到、如何校验、如何执行一次、结果如何统一表达」；不负责「是否允许」「何时执行」「Session 写盘」或「模型 offload/failover」。

---

## 设计原理（brief）

```text
LLM response
    │  normalize
    ▼
ToolCall
    │  registry.resolve
    │  validate_input
    │  loop 查 ToolPermissionMap
    │  ToolExecutor.execute
    ▼
ToolResult
    │
    ├─ loop → TurnEvent::ToolResultRecorded
    ├─ loop → llm ToolResult block
    └─ session 不由 tools 直接写入
```

同一次调用的事实顺序由 `loop` / `event` 保证：

```text
AssistantFinalized
  → ToolCallRecorded             # 执行副作用前记录模型请求
  → input validation
  → loop permission-map check
  → ToolExecutor
  → ToolResultRecorded
```

Session Item Log 是恢复事实源；TurnEvent 是由运行过程 derive 的观测流。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`model_input`** | 读取冻结的 `ToolRegistry`，把 `ToolSpec` 转成 `llm::protocol::ToolSchema` | 调 executor、执行 IO |
| **`scheduler`** | 后续基于真实资源声明接管排队、并发、offload 与 tool retry policy | 修改工具 schema、绕过 registry |
| **`loop`** | 持有 ToolRuntime；完成 resolve、validate、permission/approval、顺序执行、取消与结果配对 | 绕过输入校验或 permission map、直接写 session |
| **`agent`** | 从 `agent-tools` 构造 registry、permission map 与 approval handler，再建立 ToolRuntime | 在 loop 内临时修改注册表 |
| **`session`** | 通过 `TurnEvent` commit `ToolCall` / `ToolResult` | 反向依赖 executor |
| **测试** | 构造具体 `ToolExecutor`、验证 registry 与规范化结果 | 依赖真实 shell / 网络才能验证纯契约 |

`ToolExecutor` 是 `agent-core` 内唯一的工具 trait。`ToolSpec`、`ToolRegistry` 和 permission map 使用具体类型，不为未来可能的扩展提前增加 trait。

`agent-core::tools` 是运行时契约，不是 builtins 目录。第一方 `bash`、`grep`、`web_fetch` 等实现在独立 `agent-tools` crate 中声明；该 crate 单向依赖 `agent-core`，内核不反向依赖具体工具库。其最小公开目录接口为：

```rust
pub struct ToolDefinition { /* private: name + build function */ }
impl ToolDefinition {
    pub fn name(&self) -> &'static str;
    pub fn build(&self) -> anyhow::Result<agent_core::tools::Tool>;
}
pub fn builtin_tool_definitions() -> &'static [ToolDefinition];
```

---

## 公开契约（修订版）

以下签名是实现契约，不在实现阶段静默增加或修改。结构体字段默认私有，通过构造器创建、通过只读访问器消费。

`Tool` 是一个完整的运行时工具，内部绑定一个 `ToolSpec` 与一个 `ToolExecutor`；它不是新的 trait，也不负责权限或调度。

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

pub enum ToolContent {
    Text(String),
    Json(serde_json::Value),
}

pub enum ToolCancellationReason {
    User,
    Parent,
    Hook,
    Disposed,
}

pub enum ToolResultStatus {
    Succeeded,
    Failed { retryable: bool },
    InvalidArguments,
    UnknownTool,
    Denied,
    Cancelled { reason: ToolCancellationReason },
    OutcomeUnknown,
}

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

`ToolCall` 与 `ToolResult` 是调用生命周期仅有的两个结构体建模，并可被 event/session 直接持久化。executor 通过 `succeeded` / `failed` / `outcome_unknown` 受控构造结果；构造器只接受原始 `ToolCall`，`Tool::execute` 再校验返回身份与状态集合，避免 handler 替换调用配对或伪造 pipeline-owned 状态。loop 使用 crate 内 `with_status` 组装执行前的未知工具、非法参数、拒绝或取消结果。

permission 不属于模型能力声明，因此不放进 `ToolSpec`，也不设独立模块。组合根按 preset 从 `agent-tools` catalog 构造选中的 `Tool` 时，同步提供声明式映射并注入 `loop`：

```text
ToolPermissionMap = {
  "read_file":  Allow,
  "apply_patch": Ask,
}
```

registry 中每个工具必须恰好有一项 permission，map 不能包含未知工具。Loop 模块用 `ToolRuntime::new(registry, permissions, approval)` 在装配时校验 key 集完全一致；存在 `Ask` 时必须注入 `ToolApprovalHandler`。运行时若仍缺失配置，安全返回 `Denied`，不能默认允许。map 值只需要 `Allow | Ask`：禁用工具应从 registry 移除。

`ToolRuntime`、`ToolPermission`、`ToolApproval` 与 `ToolApprovalHandler` 定义在 [`../loop/README.md`](../loop/README.md)，不是 tools 的第二套 registry 或 executor。Hook 不参与 approval，不能返回 permission 决策。

输入校验与执行是 `agent-core` 内部能力，不额外暴露 `ValidatedToolCall`、`AuthorizedCall` 或 `ToolAdmission` 等阶段对象。`loop` 按固定顺序调用：先 `registry.resolve` 与输入校验，再查 permission map，允许后才进入 tools 的执行与结果规范化。该顺序由 loop 行为测试守门，而不是用 typestate 扩大公开 API。

`ToolCall::new` 拒绝空的 `tool_use_id` 或工具名；这类输入没有稳定配对身份，不进入调用管线。具有合法身份但名称不存在的调用，返回可配对的 `UnknownTool` 结果。

`ToolSpec::new` 还要求名称匹配 `^[A-Za-z0-9_-]{1,64}$`。这是 OpenAI / Anthropic 等当前 provider 共同可表达的可移植身份契约，必须在 registry 和首次模型请求前失败；provider adapter 不负责重命名工具。

R1 不定义通用 execution context。executor 唯一需要的宿主执行环境是调用时工作目录，因此显式接收 `working_dir`；它用于解析相对路径和设置子进程工作目录，不能通过修改进程全局 cwd 表达。tools 不负责验证目录存在性或改写路径。`run_id`、`session_id`、`turn` 等运行身份仍由 loop/session/event 持有，不下沉给每个 executor。

executor 只借用 `ToolCall`：调用事实始终由 tools 持有，执行器使用该 call 的受控构造器生成 `ToolResult`；`Tool::execute` 拒绝身份不匹配以及 `InvalidArguments` / `UnknownTool` / `Denied` / `Cancelled` 等 pipeline-owned 状态。

`ToolRegistry::validate_input` 返回的 `String` 是预期的模型参数错误说明，由 loop 转成 `InvalidArguments`；它不是基础设施错误。`Tool::execute` 隐藏具体 executor并返回身份已核验的 `ToolResult`。

---

## 结果语义

`ToolResult` 表达 MoonTide 对一次 `ToolCall` 的最终处理结果：

```text
ToolResultStatus
  ├─ Succeeded
  ├─ Failed { retryable: bool }
  ├─ InvalidArguments
  ├─ UnknownTool
  ├─ Denied
  ├─ Cancelled { reason }
  └─ OutcomeUnknown
```

状态不能从 `content` 文本推断：`"permission denied"`、`"process cancelled"` 和 `"file not found"` 不是同一种失败。

预期的工具失败作为模型可见的 tool result 返回；工具/LLM 基础设施错误通过 `anyhow::Result` 传到 turn 边界，不能在中途吞掉。R1 不把基础设施错误复制成 `ToolResultStatus`，也不为尚无 producer 的 timeout 预留状态。

`retryable` 是 `ToolResultStatus::Failed` 的一部分，供未来 scheduler 设计 tool retry policy。Loop R1 保留该字段但不自动重试 tool。`content` 是模型可见载荷；结构化 JSON 使用 `ToolContent::Json`，由 loop 映射为稳定文本。不增加第三个 output/outcome 结构。

`ToolCall`、`ToolResultStatus`、`ToolContent` 与 `ToolResult` 都采用稳定 serde 表示；SessionItem 直接包装 call/result，不复制字段。`ToolContent` 使用显式 adjacent tag：文本为 `{ "type": "text", "value": "..." }`，JSON 为 `{ "type": "json", "value": <任意 JSON> }`，因此 JSON string 不会在恢复时被误判为 Text。

### Schema 与校验语义

- R1 只定义 `input_schema`，使用 JSON Schema Draft 2020-12；`ToolRegistry::new` 冻结注册表时校验并编译 schema，禁止网络或外部 `$ref`，编译结果随 registry 缓存。
- canonical `input_schema` 的顶层 JSON 值必须是 object；object 内仍按 Draft 2020-12 校验。Draft 合法但 provider wire 无法表达的 boolean schema 在注册时拒绝，不延迟到 HTTP 请求。
- 非法 schema 是工具注册错误：`ToolRegistry::new` 返回带工具名上下文的 `anyhow::Error`，该 registry 不会暴露给模型。
- `ToolCall` 身份校验在构造时完成；调用时复用 registry 中的 validator 校验 input。失败返回 `InvalidArguments`，permission 与 executor 都不被调用。
- R1 不定义或校验 `output_schema`。executor 输出契约由 Rust 类型与测试守门；出现明确的结构化消费者后再评审 output schema。
- validator 的具体 crate 是实现细节，但必须固定支持的 dialect，并用结构测试守门。
- tools 保留并校验 canonical schema，不承担 provider 兼容转换。LLM adapter 默认透传；只有当前 provider 已确认不兼容的关键词，才在 adapter 编码处增加小型、显式且有测试的转换。R1 不建设通用 schema 编译器、capability 矩阵或转换 profile。

---

## 典型 Tool round

```text
1. LLM 的一个 ToolUse response 中按 block 顺序构造全部 ToolCall
2. 在任何副作用前，loop 依次 emit 全部 ToolCallRecorded
3. 对每个 call 顺序处理：
   a. tools.resolve(name)
   b. registry.validate_input(tool, call)
   c. loop 查询 permission；Ask 经 ToolApprovalHandler
   d. tool.execute(&call, session.header().cwd)
   e. loop emit ToolResultRecorded
4. 全部 call/result 闭合后，context.materialize 供下一 LLM Step 使用
```

tools 仍只处理一次调用；多 call 顺序与 cleanup 由 loop 编排。Loop R1 固定顺序执行：取消发生在 executor future 开始前时，当前结果为 `Cancelled { User }`；future 已开始后取消时，当前结果为 `OutcomeUnknown`；剩余未开始 sibling calls 为 `Cancelled { Parent }`。executor `Err` 使用相同的 OutcomeUnknown/Parent 配对，再传播原错误。scheduler 不是 R1 的第三道门禁。

`ToolCancellationReason::Hook` 是现有持久化枚举的兼容变体；Hook 在 Loop R1 中不能取消或阻断，因此 loop 不生产该 reason。

### 与 Session / Event / LLM 的状态映射

`ToolResultStatus` 是 host 侧单次调用的规范状态。`TurnEvent::ToolResultRecorded` 与 `SessionItem::ToolResult` 直接携带同一个 `ToolResult`，因此不会丢失 `Denied`、`Cancelled` 和 `OutcomeUnknown`。session/event 单向依赖 tools 契约，tools 不依赖其实现。

如果 executor 返回基础设施 `Err`，`Tool::execute` 原样向上传播；loop 在返回 turn 边界前，必须使用同一 `ToolCall` 组装 `OutcomeUnknown` 并 emit `ToolResultRecorded`。已知、可描述的工具失败应由 executor 返回 `Ok(ToolResult::failed(...))`，不能滥用 `Err`。

LLM 的 `ContentBlock::ToolResult` 继续承载模型可见 content，不强行暴露 host status。loop 在映射前依据 typed status 做控制流，并把 status 的说明编码到 content；不得从 content 反推 status。

---

## 两个例子

### `read_file`

```text
ToolPermissionMap["read_file"] = Allow
```

文件不存在属于 `Failed`，而不是运行时基础设施错误。它是否能与其他调用并行，要等 scheduler 根据真实资源声明判断，R1 的 ToolSpec 不提前给出二元结论。

### `apply_patch`

```text
ToolPermissionMap["apply_patch"] = Ask
```

它需要 permission 决策。scheduler 将来根据实际资源冲突决定是否排他执行；permission 级别不能替代调度声明。进程被中断且无法确认文件是否已写入时，结果必须是 `OutcomeUnknown`，不能直接报告成功或失败。

---

## 常见错误

| 做法 | 问题 |
|------|------|
| handler 自己定义 schema | model input 与执行参数可能漂移 |
| registry 同时做权限判断 | 能力目录和运行政策耦合，难以测试 |
| tools 内实现多调用并发 | scheduler 无法统一资源排队、并发窗口和 offload |
| 只返回一段错误文本 | 无法恢复、重试或判断副作用是否未知 |
| tools 直接写 Session | 破坏 `event → commit → session` 唯一写入链 |
| 动态修改当前 step 的 registry | `ModelRequest.tools` 和实际执行器不一致 |
| 为每个工具定义独立 trait | 失去统一的执行边界，扩展成本上升 |

---

## 当前阶段

本模块已完成 runtime contract、frozen registry、input validator 缓存、第一方 `grep`，以及 `ToolCall` / `ToolResult` 的 session/event 复用。后续按以下顺序推进：

1. 在 model_input 中完成 `ToolSpec` → `ToolSchema` 的稳定映射；
2. 在 loop 中完成 ToolUse → ToolCall、校验、permission、执行与结果回填；
3. 为完整拒绝顺序与 executor `Err` 的 `OutcomeUnknown` 配对补端到端测试；
4. 后续由 `scheduler` 接管资源调度、并发、tool retry 与模型 offload 验收；Turn cancellation 仍由 loop 的 CancellationToken 负责。

后续集成不得把 `verify/failover` 重新塞回 tools。
