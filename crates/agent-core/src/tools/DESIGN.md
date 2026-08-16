# tools — 技术设计

> **读者：** 实现者、代码审查。
> **对外集成：** [`README.md`](README.md)。
> **状态：** 架构已确认；实现尚未开始。
> **关联：** [`../llm/DESIGN.md`](../llm/DESIGN.md) · [`../session/DESIGN.md`](../session/DESIGN.md) · [`../event/DESIGN.md`](../event/DESIGN.md) · [`../../../../docs/notes/runtime/agent-kernel-architecture.md`](../../../../docs/notes/runtime/agent-kernel-architecture.md)

---

## 1. 目标与边界

### 1.1 目标

`tools` 提供模型能力的稳定、可测试、可审计的**单次调用契约**：

1. 用纯 `ToolSpec` 描述模型可见能力；
2. 用 `ToolRegistration` 把 spec 与实现绑定；
3. 用不可变 `ToolRegistry` 提供确定性的名称解析和 schema 暴露；
4. 校验一次 `ToolCall` 的输入；
5. 通过唯一 `ToolExecutor` trait 执行真实副作用；
6. 将 executor 输出统一为带状态的 `ToolResult`；
7. 为 `prompt`、`loop`、`permission`、`scheduler` 提供明确接缝。

### 1.2 明确不做

| 不做 | 所属模块 |
|------|----------|
| 允许 / 拒绝 / 询问的最终政策 | `permission` |
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
permission ───────────► tools（读取 spec/call）
scheduler ────────────► tools（读取 execution policy，调用单次入口）
loop ─────────────────► tools + llm + event
tools ────────────────► serde / serde_json / anyhow / std
```

`tools` 不反向 import `loop`、`permission`、`scheduler`、`session`、`event` 或 `llm`。跨模块转换由上层完成：例如 `prompt` 把 `ToolSpec` 映射为 `llm::protocol::ToolSchema`，`loop` 把 `ToolResult` 映射为 `llm::protocol::ContentBlock::ToolResult` 和 `RunEvent`。

`agent-core` 只保留两个 trait：`LLMProvider` 和 `ToolExecutor`。其余结构使用具体类型和策略枚举。

---

## 2. 模块结构

```text
tools/
  README.md
  DESIGN.md
  mod.rs
  spec.rs          # ToolSpec、审批下限、执行策略
  registration.rs  # ToolRegistration、ToolRegistry、冻结 snapshot
  call.rs          # ToolCall、ToolExecutionContext
  executor.rs      # ToolExecutor trait
  result.rs        # ToolOutput、ToolResult、状态与内容
  validate.rs      # 名称、输入/输出 schema、结果规范化
  tests.rs
```

文件可以在实现时合并，但职责不能合并成一个“大 Tool trait”或一个拥有所有决策的 registry。

---

## 3. 核心类型

### 3.1 `ToolSpec`

```rust
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
    pub approval: ToolApprovalFloor,
    pub execution: ToolExecutionPolicy,
}
```

约束：

- `name` 非空且在 registry 内唯一；
- `description` 是模型可见说明，不承载运行时状态；
- `input_schema` 是纯 JSON Schema 数据，不执行 IO；
- `output_schema` 是 host-side 可选校验，不默认改变模型 prompt；
- `approval` 是工具声明的最低审批要求，不等于最终 permission 决策；
- `execution` 只声明静态能力，不直接启动并发。

```rust
pub enum ToolApprovalFloor {
    AutoAllowed,
    AlwaysAsk,
}

pub enum ToolExecutionPolicy {
    Exclusive,
    ParallelSafe,
}
```

`ParallelSafe` 是工具对 scheduler 的安全声明，不代表所有调用在任何资源上都可以并行。路径级资源 claim、全局锁和动态冲突放到 scheduler。

### 3.2 `ToolRegistration`

```rust
pub struct ToolRegistration {
    pub spec: ToolSpec,
    pub executor: std::sync::Arc<dyn ToolExecutor>,
}
```

registration 是唯一将“模型看到的契约”和“宿主实际执行器”绑定的地方。executor 不在 `ToolSpec` 中定义 schema；spec 也没有 IO 回调。

### 3.3 `ToolRegistry`

Registry 的构建与使用分成两个阶段：

```text
agent 装配 registrations
  → validate all registrations
  → reject duplicate names
  → freeze
  → 当前 LLM step 使用 snapshot
```

要求：

1. frozen snapshot 在一个 LLM step 内不可变；
2. 迭代顺序稳定，prompt 和测试不依赖 HashMap 顺序；
3. lookup、schema 暴露和执行器绑定来自同一 registration；
4. 动态/MCP 工具变化从下一 step 的新 snapshot 生效；
5. registry 不包含 permission callback、session writer、UI emitter 或 scheduler queue。

### 3.4 `ToolCall`

```rust
pub struct ToolCall {
    pub tool_use_id: String,
    pub name: String,
    pub input: serde_json::Value,
}
```

`ToolCall` 是模型请求事实的运行时表示。它不携带 executor、permission 结果或 session item id；这些信息属于不同阶段。

解析约束由 `loop` 保证，tools 负责再次守门：

- `tool_use_id` 非空；
- `name` 非空；
- `input` 必须是合法 JSON；
- 找不到 name 时不能 panic，应生成 `UnknownTool` 结果。

### 3.5 `ToolExecutionContext`

这是窄的具体上下文，不是 service locator：

```rust
pub struct ToolExecutionContext {
    pub run_id: String,
    pub session_id: String,
    pub turn: u64,
    pub cwd: std::path::PathBuf,
    // cancellation / environment fields follow the agreed concrete runtime type
}
```

不得把 `SessionStore`、`EventDispatcher`、permission engine、LLM provider 或 UI sink 塞进 context。需要这些能力的协调应回到上层模块。

### 3.6 `ToolExecutor`

```rust
pub trait ToolExecutor: Send + Sync {
    fn execute<'a>(
        &'a self,
        call: ToolCall,
        context: &'a ToolExecutionContext,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = anyhow::Result<ToolOutput>> + Send + 'a>,
    >;
}
```

约束：

- executor 只接收已经由上层准入的单个调用；
- executor 不自行决定 permission；
- executor 不生成/修改 `tool_use_id`；
- executor 不写 Session 或 RunEvent；
- 预期业务失败返回 `Ok(ToolOutput { outcome: Failed, ... })`；
- IO、进程、协议等基础设施错误返回 `Err(anyhow::Error)`；
- 不使用 `unwrap`、`expect` 或 panic 处理外部输入。

### 3.7 `ToolOutput` 与 `ToolResult`

```rust
pub enum ToolOutputOutcome {
    Succeeded,
    Failed { retryable: bool },
    OutcomeUnknown,
}

pub struct ToolOutput {
    pub outcome: ToolOutputOutcome,
    pub content: ToolContent,
    pub structured: Option<serde_json::Value>,
}

pub enum ToolContent {
    Text(String),
    Json(serde_json::Value),
}

pub enum ToolResultStatus {
    Succeeded,
    Failed,
    InvalidArguments,
    UnknownTool,
    Unavailable,
    Denied,
    Cancelled,
    TimedOut,
    OutcomeUnknown,
    InternalError,
}

pub struct ToolResult {
    pub tool_use_id: String,
    pub name: String,
    pub status: ToolResultStatus,
    pub content: ToolContent,
    pub structured: Option<serde_json::Value>,
}
```

`ToolOutput` 是 executor 的语义输出；`ToolResult` 是 tools 单次调用入口经过校验、准入结果和 executor 输出归一后的边界结果。后者才允许上层转换成模型的 ToolResult block。

`Denied`、`Cancelled`、`InvalidArguments` 等不是 executor 的业务结果，而是调用管线的结果。handler 不能通过返回普通内容伪造这些状态。

---

## 4. 单次调用算法

```text
execute_one(registry, call, context, admission):
  1. validate_call_identity(call)
  2. registration = registry.resolve(call.name)
     └─ missing → ToolResult::UnknownTool
  3. validate_input(registration.spec.input_schema, call.input)
     └─ invalid → ToolResult::InvalidArguments
  4. consume admission result from permission/scheduler
     ├─ denied    → ToolResult::Denied
     ├─ cancelled → ToolResult::Cancelled
     └─ admitted  → continue
  5. output = registration.executor.execute(call, context).await?
  6. validate optional output_schema
     └─ invalid → boundary error / normalized failure according to policy
  7. normalize output → ToolResult
  8. return ToolResult
```

tools 不自行调用 permission 或 scheduler；步骤 4 的 `admission` 是上层传入的具体结果，避免 tools 反向依赖高层策略。

多调用算法不属于这里。scheduler 负责决定调用顺序、并行窗口、资源冲突、取消后哪些调用尚未开始，以及模型 offload 的验收。

---

## 5. 错误边界

| 场景 | tools 结果 | 是否继续 run |
|------|------------|--------------|
| 未知工具 | `UnknownTool`，模型可见 | 通常继续，让模型修正 |
| 输入 schema 不合法 | `InvalidArguments` | 通常继续 |
| permission 拒绝 | `Denied` | 由 loop/policy 决定 |
| 工具业务失败 | `Failed` + 文本/结构化原因 | 通常继续 |
| 工具不可用 | `Unavailable` | 通常继续或由 scheduler 重试 |
| 调用被取消且未开始 | `Cancelled` | 由 loop 结束/继续 |
| 执行中断但副作用未知 | `OutcomeUnknown` | 禁止假装成功；由 scheduler 决定恢复 |
| executor IO/协议基础设施故障 | `anyhow::Error` 传到 run 边界 | 统一处理，不中途吞掉 |

工具预期失败是模型输入的一部分；基础设施故障是运行边界错误。两者不能都编码成一段普通字符串。

---

## 6. 与相邻模块的接缝

### 6.1 与 `llm`

`tools` 不持有 provider，也不认识厂商 wire protocol。

```text
ToolSpec ──prompt.compile──► llm::protocol::ToolSchema
ToolResult ──loop 映射──────► llm::protocol::ContentBlock::ToolResult
```

当前 `llm::protocol::ToolSchema` 只有 name、description、input schema；`output_schema` 是 host-side 能力，是否映射到模型由 `prompt` 决定。

### 6.2 与 `permission`

工具 registration 声明 `ToolApprovalFloor`；permission 结合运行时策略给出最终 decision。声明是最低要求，不能降低全局 deny 或用户确认要求。

```text
ToolSpec.approval + ToolCall + run policy
    → permission decision
```

### 6.3 与 `scheduler`

`ToolExecutionPolicy` 只是一项静态能力声明。scheduler 仍要结合调用集合、资源、取消和运行配置决定实际执行计划。

```text
ToolSpec.execution + calls + resources + cancellation
    → scheduler admission / execution plan
```

`verify`、模型 offload、failover 和 retry 不属于 tools。

### 6.4 与 `session` / `event`

tools 不直接写盘、不发布 event。loop/event 按既定顺序负责：

```text
ToolInvocationRecorded → session::ToolInvocation
ToolOutcomeRecorded    → session::ToolOutcome
```

Session Item Log 是事实源；Agent Event Log 只是 RunEvent derive 的观测记录。

---

## 7. 不变量

### Registry

1. 一个 frozen snapshot 内工具名唯一；
2. prompt 暴露的 spec 与实际 executor 来自同一 registration；
3. snapshot 冻结后不能增删改；
4. registry 迭代顺序稳定；
5. registry 不执行权限、调度或 IO。

### Call

6. `tool_use_id`、`name` 非空；
7. 未知工具和非法输入不 panic；
8. 每个接收的 call 最终生成一个可配对的 `ToolResult`，或在 run 边界返回基础设施错误；
9. handler 不能修改调用身份或伪造 permission/scheduler 状态。

### Result

10. `status` 与 `content` 独立；
11. `OutcomeUnknown` 不能降级成 `Succeeded`；
12. 预期业务失败可模型可见；基础设施错误向上传播；
13. 输出 schema 校验失败不能静默当作成功。

### Integration

14. tools 不写 Session Item Log；
15. tools 不产生 RunEvent；
16. 多调用并发、取消补偿、offload 验收归 scheduler；
17. 动态 registry 变化下一 step 才生效。

---

## 8. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | `ToolSpec`、approval/execution policy、`ToolCall`、`ToolExecutor`、`ToolOutput` / `ToolResult` |
| **R2** | frozen registry、重复注册、稳定排序、input/output schema 守门 |
| **R3** | 单次调用入口、admission 结果映射、错误/取消/未知结果规范化 |
| **R4** | 与 prompt、loop、session、event 的契约联调 |
| **后置** | scheduler 资源 claim、bounded pool、模型 offload/failover、artifact spill |

每批实现前先更新本文件的类型和不变量，再由 `batch-implement` 按 review 批推进。`tools` 设计不因后置 scheduler 的复杂度提前膨胀。

---

## 9. 单测方向

### 9.1 测试注释要求

每个 `#[test]` / `#[tokio::test]` 必须在测试函数前写清楚注释，不能只依赖测试函数名表达意图。注释至少说明三件事：

1. **场景**：输入、registry/admission 状态或故障条件；
2. **预期**：返回值、状态或错误边界；
3. **不变量 / 副作用**：例如 executor 不得被调用、调用身份必须保持、不得写 Session。

统一使用下面的短格式，复杂场景可补充执行顺序：

```rust
// 场景：registry 中不存在模型请求的工具名。
// 预期：返回 UnknownTool；executor 不被调用，调用身份保持可配对。
#[test]
fn unknown_tool_returns_unknown_tool_without_execution() {
    // ...
}
```

测试注释描述的是被守门的架构契约，不要写成“调用某函数并断言某值”的实现流水账。测试行为改变时，必须同步更新注释；代码审查将把缺少场景/预期/不变量说明视为测试不完整。

### 9.2 覆盖方向

- 空名称、重复名称、非法 schema 被拒绝；
- registry 冻结后不能改变，顺序稳定；
- prompt 暴露的 spec 与 dispatch 使用同一 registration；
- unknown tool → `UnknownTool`；
- 非法 input → `InvalidArguments`，且 executor 不被调用；
- admission denied/cancelled → 对应状态，且 executor 不被调用；
- expected business failure → `Failed` + 内容；
- executor infrastructure error → `anyhow::Error` 向上传播；
- `OutcomeUnknown` 不会被归一成成功；
- output schema 失败不会静默成功；
- 每个成功进入执行的 call 都能生成稳定的 result 配对信息；
- tools 不 import session/event/permission/scheduler 的结构测试守门。

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
