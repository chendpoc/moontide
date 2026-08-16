# tools

> **对外使用说明** — 集成 `agent-core::tools` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)。
> **状态：** 架构已确认；实现尚未开始。
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
    │  registry.resolve + input validation
    ▼
Validated call
    │  permission.check
    ▼
Authorized call
    │  scheduler.admit
    ▼
Execution plan
    │  ToolExecutor.execute
    ▼
ToolOutput → ToolResult
    │              │
    │              ├─ loop → RunEvent::ToolOutcomeRecorded
    │              └─ loop → llm ToolResult block
    └─ session 不由 tools 直接写入
```

同一次调用的事实顺序由 `loop` / `event` 保证：

```text
AssistantFinalized
  → ToolInvocationRecorded       # 执行副作用前记录模型请求
  → permission / scheduler
  → ToolExecutor
  → ToolOutcomeRecorded
```

Session Item Log 是恢复事实源；RunEvent 是由运行过程 derive 的观测流。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`prompt`** | 读取冻结的 `ToolRegistry`，把 `ToolSpec` 转成 `llm::protocol::ToolSchema` | 调 executor、执行 IO |
| **`permission`** | 读取 `ToolSpec.approval` 与 `ToolCall`，返回授权决策 | 直接执行工具 |
| **`scheduler`** | 读取执行策略，决定排队、串并行、取消、offload、重试 | 修改工具 schema、绕过 registry |
| **`loop`** | 解析模型 `ToolUse`，调用 tools 的单次调用入口，emit RunEvent | 直接调用 executor、直接写 session |
| **`agent`** | 创建注册表、注入内置/sidecar executor，在 step 前冻结 snapshot | 在 loop 内临时修改注册表 |
| **`session`** | 通过 `RunEvent` commit `ToolInvocation` / `ToolOutcome` | 反向依赖 executor |
| **测试** | 构造具体 `ToolExecutor`、验证 registry 与规范化结果 | 依赖真实 shell / 网络才能验证纯契约 |

`ToolExecutor` 是 `agent-core` 内唯一的工具 trait。`ToolSpec`、`ToolRegistry`、权限和调度策略使用具体类型，不为未来可能的扩展提前增加 trait。

---

## 公开契约（R1 草案）

字段名是设计契约，最终 Rust 可见性以实现为准：

```rust
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>, // host 校验；不一定发给模型
    pub approval: ToolApprovalFloor,
    pub execution: ToolExecutionPolicy,
}

pub enum ToolApprovalFloor {
    AutoAllowed,
    AlwaysAsk,
}

pub enum ToolExecutionPolicy {
    Exclusive,
    ParallelSafe,
}

pub struct ToolRegistration {
    pub spec: ToolSpec,
    pub executor: std::sync::Arc<dyn ToolExecutor>,
}

pub struct ToolCall {
    pub tool_use_id: String,
    pub name: String,
    pub input: serde_json::Value,
}

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

`ToolExecutor` 只返回不带模型调用身份的 `ToolOutput`。`tool_use_id`、最终状态和模型可见包装由 tools 的单次调用入口统一生成，避免 handler 伪造调用配对或权限状态。

---

## 结果语义

`ToolOutput` 表达执行器产生的内容；`ToolResult` 表达 MoonTide 对这次调用的最终规范化结果。

```text
ToolOutput
  ├─ outcome: Succeeded | Failed | OutcomeUnknown
  ├─ content: Text | Json
  └─ structured: Option<Json>

ToolResultStatus
  ├─ Succeeded
  ├─ Failed
  ├─ InvalidArguments
  ├─ UnknownTool
  ├─ Unavailable
  ├─ Denied
  ├─ Cancelled
  ├─ TimedOut
  ├─ OutcomeUnknown
  └─ InternalError
```

状态不能从 `content` 文本推断：`"permission denied"`、`"process cancelled"` 和 `"file not found"` 不是同一种失败。

预期的工具失败作为模型可见的 tool result 返回；工具/LLM 基础设施错误通过 `anyhow::Result` 传到 run 边界，不能在中途吞掉。`InternalError` 只在运行边界需要保持调用配对时生成，不是 handler 自行伪造的普通业务结果。

---

## 典型调用

```text
1. LLM 返回 ToolUse { id, name, input }
2. loop 构造 ToolCall
3. loop emit ToolInvocationRecorded
4. tools.resolve(name)
5. tools.validate_input(spec, input)
6. permission.check(spec, call)
7. scheduler.admit(call, spec.execution)
8. tools.execute_one(call, context)
9. tools.normalize_output(call, output)
10. loop emit ToolOutcomeRecorded
11. loop 将 ToolResult 转成下一条 llm ToolResult block
```

`tools.execute_one` 只处理一次调用；多调用的 fan-out、资源冲突、完成顺序和 offload 验收属于 `scheduler`。

---

## 两个例子

### `read_file`

```text
approval  = AutoAllowed（仍受 permission 全局规则约束）
execution = ParallelSafe
```

它可以和其他只读调用并行。文件不存在属于 `Failed`，而不是运行时基础设施错误。

### `apply_patch`

```text
approval  = AlwaysAsk
execution = Exclusive
```

它需要 permission 决策，并由 scheduler 排他执行。进程被中断且无法确认文件是否已写入时，结果必须是 `OutcomeUnknown`，不能直接报告成功或失败。

---

## 常见错误

| 做法 | 问题 |
|------|------|
| handler 自己定义 schema | prompt 与执行参数可能漂移 |
| registry 同时做权限判断 | 能力目录和运行政策耦合，难以测试 |
| tools 内实现多调用并发 | scheduler 无法统一取消、排队和 offload |
| 只返回一段错误文本 | 无法恢复、重试或判断副作用是否未知 |
| tools 直接写 Session | 破坏 `event → commit → session` 唯一写入链 |
| 动态修改当前 step 的 registry | prompt 中的工具目录和实际执行器不一致 |
| 为每个工具定义独立 trait | 失去统一的执行边界，扩展成本上升 |

---

## 当前阶段

本模块当前完成的是架构设计，不包含实现。下一阶段按以下顺序推进：

1. 实现纯类型、registry 和单次调用规范化；
2. 为未知工具、重复注册、输入/输出 schema、结果状态建立结构测试；
3. 与 `llm`、`session`、`event` 对齐 ToolResult 状态和序列化；
4. 最后由 `scheduler` 接管多调用调度、取消和模型 offload 验收。

实现前不得把 `verify/failover` 重新塞回 tools。
