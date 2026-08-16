# tools — 技术设计

> **读者：** 实现者、代码审查。
> **对外集成：** [`README.md`](README.md)。
> **状态：** RB2 实现中；`ToolCall` / `ToolResult` 唯一建模及 session/event typed 接缝已落地。
> **关联：** [`../llm/DESIGN.md`](../llm/DESIGN.md) · [`../session/DESIGN.md`](../session/DESIGN.md) · [`../event/DESIGN.md`](../event/DESIGN.md) · [`../../../../docs/notes/runtime/agent-kernel-architecture.md`](../../../../docs/notes/runtime/agent-kernel-architecture.md)

---

## 1. 目标与边界

### 1.1 目标

`tools` 提供模型能力的稳定、可测试、可审计的**单次调用契约**：

1. 用纯 `ToolSpec` 描述模型可见能力；
2. 用 `Tool` 把 spec 与实现绑定；
3. 用不可变 `ToolRegistry` 提供确定性的名称解析和 schema 暴露；
4. 校验一次 `ToolCall` 的输入；
5. 通过唯一 `ToolExecutor` trait 执行真实副作用；
6. 让 executor 直接返回带状态的 `ToolResult`；
7. 为 `prompt`、`loop`、`scheduler` 提供明确接缝。

### 1.2 明确不做

| 不做 | 所属模块 |
|------|----------|
| 允许 / 询问声明与交互 | `agent` 组合根提供 map，`loop` 查表并处理 `Ask` |
| 多调用 fan-out、排队、并行、资源冲突 | `scheduler` |
| 取消树、重试、模型 offload/failover 验收 | `scheduler` / `loop` |
| Session Item Log 写入 | `event` commit → `session` |
| Agent Event Log、UI、telemetry | `event` / `cli` |
| prompt 文本组装 | `prompt` |
| LLM wire 协议和 provider | `llm` |
| sidecar IPC | `agent` / 后置 runtime |

### 1.3 依赖方向

```text
prompt ───────────────► tools（读取 ToolSpec）
scheduler ────────────► tools（读取调用/结果契约，调用单次入口）
loop ─────────────────► tools + llm + event
agent-tools ──────────► tools（实现第一方 executor，构造 Tool）
tools ────────────────► serde / serde_json / anyhow / std
```

`tools` 不反向 import `loop`、`scheduler`、`session`、`event`、`llm` 或 `agent-tools`。跨模块转换由上层完成：例如 `prompt` 把 `ToolSpec` 映射为 `llm::protocol::ToolSchema`，`loop` 把 `ToolResult` 映射为 `llm::protocol::ContentBlock::ToolResult` 和 `RunEvent`。`agent-tools` 是相邻的第一方实现库，不是内核 mod；其 `ToolDefinition` 只保存静态 name 与零参数 build function，`build()` 返回已绑定 spec/executor 的 `Tool`，不复制第二套 runtime registry。

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
2. 迭代顺序稳定，prompt 和测试不依赖 HashMap 顺序；
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

执行前取消由 loop 处理；执行中取消由未来的 scheduler/具体 executor 处理，无法确认副作用时返回 `OutcomeUnknown`。不定义 `ToolAdmission` 或阶段型 call wrapper；permission、取消、超时和 scheduler 计划由实际拥有决策的模块表达。

约束：

- executor 只接收已经由 loop 完成输入校验且 permission 允许的单个调用；
- executor 不自行决定 permission；
- executor 不生成/修改 `tool_use_id`；
- executor 不写 Session 或 RunEvent；
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
          → return Err(error) to run boundary

Tool::execute:
  6. result = tool.executor.execute(&call, working_dir).await?
  7. verify result identity matches call and status belongs to executor result set
  8. return result
```

输入校验和执行边界由 tools 提供，permission map lookup 与总体顺序由 loop 编排。这里不为阶段顺序创建 `ValidatedToolCall` 或 `ToolAdmission`；顺序不变量由 loop 测试守门。`ToolResultStatus::Failed { retryable }` 必须保留 retryable；`OutcomeUnknown` 不得降级为成功。

多调用算法不属于这里。scheduler 后置负责调用顺序、并行窗口、资源冲突、取消后哪些调用尚未开始，以及模型 offload 的验收；它不进入当前 MVP 的单调用执行前门禁。

---

## 5. 错误边界

| 场景 | tools 结果 | 是否继续 run |
|------|------------|--------------|
| registry 中存在非法 schema 文档 | `ToolRegistry::new` 返回 `anyhow::Error`，不产生 registry | 不启动该配置 |
| 未知工具 | `UnknownTool`，模型可见 | 通常继续，让模型修正 |
| 调用 input 不匹配 schema | `InvalidArguments` | 通常继续 |
| permission 拒绝 | `Denied` | 由 loop/policy 决定 |
| 工具业务失败 | `Failed { retryable }` + 文本/结构化原因 | 通常继续 |
| 调用被取消且未开始 | `Cancelled { reason }` | 由 loop 结束/继续 |
| 执行中断但副作用未知 | `OutcomeUnknown` | 禁止假装成功；由 scheduler 决定恢复 |
| executor IO/协议基础设施故障 | loop 先记录 `OutcomeUnknown`，再把原始 `anyhow::Error` 传到 run 边界 | 不吞错，不留下未配对 invocation |

工具预期失败是模型输入的一部分；基础设施故障是运行边界错误。两者不能都编码成一段普通字符串。`Tool::execute` 不吞基础设施错误，也不自行 emit；loop 使用仍持有的 `ToolCall` 先记录一个 `OutcomeUnknown` 的配对结果，再传播原始错误。R1 不为基础设施故障复制 `InternalError` / `Unavailable` 状态，也不为尚无 scheduler/loop producer 的 timeout 预留 `TimedOut`；出现真实 producer 与恢复语义后再扩展。

---

## 6. 与相邻模块的接缝

### 6.1 与 `llm`

`tools` 不持有 provider，也不认识厂商 wire protocol。

```text
ToolSpec ──prompt.compile──► llm::protocol::ToolSchema
ToolResult ──loop 映射──────► llm::protocol::ContentBlock::ToolResult
```

当前 `llm::protocol::ToolSchema` 只有 name、description、input schema，与 tools R1 契约一致。

`prompt` 只复制 canonical schema，不改写关键词。具体 LLM adapter 编码时默认透传；已确认的 provider 关键词异常可以在该编码路径中做最小转换，但不反向改变 `ToolSpec` 或 registry validator。该兼容工作属于 R4 接缝，不进入 tools RB1。

### 6.2 与 `ToolPermissionMap`

permission 声明不进入 `ToolSpec`，当前也不设独立模块。组合根注册工具时同时构造声明式 map，并注入 `loop`：

```text
ToolRegistry:      tool_name → Tool { spec, executor }
ToolPermissionMap: tool_name → Allow | Ask
```

二者必须满足 key 集完全一致：registry 中不能有未声明 permission 的工具，permission map 也不能引用未知工具。该不变量由组合根构造检查和 conformance 测试守门；运行时缺失项作为安全兜底映射为 `Denied`，绝不默认 allow。`Deny` 不作为声明值：禁用工具从 registry 移除，不再暴露给模型。

`loop` 按 name 查询 map 并处理 `Ask`，不把规则解释下沉给 `ToolSpec`、registry 或 executor。sidecar 只能提供 executor，不能修改宿主 permission map。只有路径、命令前缀、session scope 或动态风险等真实规则出现后，才重新评审是否提取独立模块。

### 6.3 与 `scheduler`

tools R1 只提供单次调用与结果契约，不预设 scheduler 的资源模型。scheduler 仍要结合调用集合、调用参数、资源、取消和运行配置决定实际执行计划；出现明确模型后，再评审是否需要扩展 `ToolSpec`。

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

Session Item Log 是事实源；Agent Event Log 只是 RunEvent derive 的观测记录。

该接缝直接携带完整 `ToolResult`，因此 typed `ToolResultStatus` 不会丢失。这是高层对 tools **契约类型**的单向依赖，tools 不依赖高层实现。

loop 集成仍必须覆盖 executor `Err` 路径：loop 先 emit status 为 `OutcomeUnknown` 的 `ToolResultRecorded`，等待 commit 成功后再把原始 `anyhow::Error` 返回 run 边界。禁止只记录 call 后直接 `?` 返回；也禁止 event/session 层自行猜测或补写 result。

Session Item Log 已升级到 v2，新写入使用 `tool_call` / `tool_result`。读取 v1 时通过 serde alias 接受旧 kind，对缺失 status 的历史结果映射为 `OutcomeUnknown`，禁止默认推断为 `Succeeded`。

LLM 的 `ContentBlock::ToolResult` 仍只承载模型可见 content。loop 先使用 typed status 决定控制流，再把 status 说明编码为 content；不能在恢复或控制流中从 content 文本反推 status。

---

## 7. 不变量

### Registry

1. 一个 frozen snapshot 内工具名唯一；
2. prompt 暴露的 spec 与实际 executor 来自同一 `Tool`；
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
19. tools 不产生 RunEvent；
20. 多调用并发、取消补偿、offload 验收归 scheduler；
21. 动态 registry 变化下一 step 才生效；
22. session/event 直接包装 `ToolCall` / `ToolResult`，不得复制同义字段结构。

---

## 8. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | `ToolSpec`、`ToolCall`、`ToolExecutor`、`ToolResult` |
| **R2** | frozen registry、重复注册、稳定排序、input schema 守门 |
| **R3** | 输入校验、executor 调用、错误/未知结果规范化 |
| **RB2** | 删除重复结果模型；SessionItem/RunEvent 直接携带 `ToolCall` / `ToolResult`；Session v2 兼容读取 v1 |
| **R4** | 与 prompt、loop 的完整调用顺序联调 |
| **后置** | scheduler 资源 claim、bounded pool、模型 offload/failover、artifact spill |

每批实现前先更新本文件的类型和不变量，再由 `batch-implement` 按 review 批推进。实现阶段发现必须改变上述公开签名时，停止当前批次，先回架构对齐；不能在 TASKS 中以“必要时补充文档”代替确认。`tools` 设计不因后置 scheduler 的复杂度提前膨胀。

---

## 9. 单测方向

- 空名称、非法字符、超过 64 字节的名称、重复名称被拒绝；
- 非 object 或非法 Draft 2020-12 schema 被拒绝；错误包含工具名且不产生部分 registry；
- registry 冻结后不能改变，顺序稳定；
- registry 构造后调用复用已编译 validator，不做 lazy schema 初始化；
- registry 不暴露可变 `Tool`；
- prompt 暴露的 spec 与 dispatch 使用同一 `Tool`；
- `ToolCall::new` 拒绝空 identity，合法 identity 的 unknown tool 仍返回可配对结果；
- registry `resolve` 未命中返回 `None`，`ToolResult::with_status` 可表达 `UnknownTool`；完整映射顺序由 loop 集成测试守门；
- 非法 input → `InvalidArguments`，且 executor 不被调用；
- permission 的 allowed/denied 顺序与映射在 loop 集成批测试，不在 tools RB1 伪造 admission；
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
7. Session Item Log 记录事实，RunEvent 记录派生观测；
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
