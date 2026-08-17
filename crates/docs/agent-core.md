# MoonTide Agent Core — Rust 系统设计

> **状态：** 当前 Rust 系统设计；随内核模块逐步落地。
> **工程规则：** [`engineering-handbook.md`](engineering-handbook.md)
> **模块进度：** [`../agent-core/README.md`](../agent-core/README.md)
> **历史设计：** [`../../docs/archive/spec/agent-core.md`](../../docs/archive/spec/agent-core.md)

本文描述 `agent-core` 的系统级 owner、依赖方向和跨模块不变量。模块局部 API 与实现细节仍以对应源码目录的 README/DESIGN 为准；冲突时遵循工程手册的权威顺序。

---

## 1. Crate 分层

MVP 使用四个 crate：

```text
cli（纯壳）→ agent（组合根）
               ├──► agent-core（运行引擎）
               └──► agent-tools（第一方 tools）──► agent-core
```

| crate | 负责 | 不负责 |
|-------|------|--------|
| `agent-core` | provider-neutral 协议、session、tool runtime contract、事件、请求组装和运行编排 | CLI 呈现、preset、第一方 builtin 实现 |
| `agent-tools` | 第一方 tool catalog、spec 与 executor | runtime registry、permission、loop |
| `agent` | preset、provider、tool/permission 组合、turn 输入解析 | 在组合根复制内核时序 |
| `cli` | 参数、REPL、渲染 | 业务状态与内核策略 |

依赖只能向下：`agent-tools → agent-core`，`agent → agent-core + agent-tools`，`cli → agent`。`agent-core` 不反向依赖任何上层 crate。

---

## 2. 八个内核模块

八个模块保留在同一 `agent-core` crate 内，不因目录整齐提前拆 crate：

| 模块 | Owner | 直接依赖 | 当前阶段 |
|------|-------|----------|----------|
| `llm` | MoonTide 协议、provider port、adapter/normalize、request preflight | 基础库 | 已实现 |
| `session` | Session Item Log 的 create/load/commit/fork 与恢复不变量 | llm/tools 契约 | 已实现 |
| `tools` | ToolSpec、Tool、冻结 registry、input validation、单次执行 | 基础库 | 已实现 |
| `event` | RunEvent、dispatcher、derive、Agent Event recorder | llm/tools 契约 | 当前分期已实现；完整 bus 后置 |
| `model_input` | provider-neutral `ModelRequest` 的纯组装 | llm protocol + tools | R1 已实现并完成测试 |
| `context` | Session Item Log → model-visible messages 的 `materialize` | session + llm protocol + tools | R1 实现与测试完成，等待本批 Review |
| `loop` | turn/step 时序、tool permission 查表和调用编排 | 模块 1–6 | 待设计 |
| `scheduler` | 后置的资源排队、并发、取消、delegate/offload | llm + tools | 后置 |

模块依赖必须保持单向：

```text
llm / tools
    ▲
session / event
    ▲
model_input / context
    ▲
loop
    ▲
agent（组合根）
```

这张图表达约束，不表达完整调用顺序。`model_input` 与 `context` 是并列装配边界，彼此不互相 import。

---

## 3. 三条事实与观测边界

```text
Session Item Log ──materialize──► messages ──compile──► ModelRequest
       │                                                       │
       └────────────── RunEvent / derive ─────────────► Agent Event Log
```

- **Session Item Log** 是可恢复事实源，`session` 是唯一写者；
- **Agent Event Log** 是 run 级观测记录，由 `RunEvent` derive，不反向覆盖 session；
- **ModelRequest** 是单次模型调用产物，不是事实源，不持久化替代 session；
- provider adapter 只编码请求，不修改 session/context 语义。
- `Message` / `ModelRequest` 是 MoonTide 的 canonical provider-neutral 数据格式；`llm::adapter` 负责转换为目标 provider wire request，`context` 不参与该转换。

---

## 4. 请求组装边界

一次模型调用的输入来自四个 owner：

| 输入 | Owner | 生命周期 |
|------|-------|----------|
| `ModelRequestConfig` | `agent` 的 turn config resolution | 当前 user turn 稳定 |
| `SystemPrompt` | `agent::resolveTurnContext` | 每 user turn 解析一次 |
| `Vec<Message>` | `context::materialize` | 每 model step 可变化 |
| `ToolRegistry` | `agent` 组合根 | frozen snapshot；step 内稳定 |

唯一组装函数位于 `model_input`：

```rust
pub(crate) fn compile(
    config: &ModelRequestConfig,
    system_prompt: &SystemPrompt,
    messages: Vec<Message>,
    tool_registry: &ToolRegistry,
) -> ModelRequest;
```

可见性是架构守门：

- `SystemPrompt` / `ModelRequestConfig` 跨 crate 由 `agent` 构造，因此公开；
- `compile` 只有同 crate 的 `loop` 调用，因此是 `pub(crate)`；
- runtime 不在 `loop` 外直接构造 `ModelRequest`；
- llm/adapter 单元测试可以直接构造协议值，不属于 runtime 绕过。

`compile` 是 infallible 纯映射。空 model、空 messages、零 max_tokens 仍能完成组装，统一由 `llm` preflight 拒绝；tool name 由 `ToolSpec::new` 校验，重复项与 input schema 由 `ToolRegistry::new` 校验。

---

## 5. Context 边界

`context` R1 已将输入输出边界落在模块 README/DESIGN，实现与测试已完成，当前等待本批 Review：

```text
Session Item Log ──context::materialize──► model-visible Vec<Message>
```

```rust
pub(crate) fn materialize(
    items: &[SessionItem],
) -> anyhow::Result<Vec<Message>>;
```

R1 直接映射普通 user/assistant items，聚合连续 tool call/result，忽略 checkpoint metadata；遇到 `Compaction`、未配对的 tool call/result 或身份不一致时返回错误。一个连续 ToolCall 段是一次 round，loop 可以并行 fan-out，但每个 call 都必须有 deadline，且所有 call 产生 ToolResult 后才能进入下一 model step；context 只验证这一闭合条件，不拥有并发或 timeout 实现。该函数只读，不写回 session，也不拥有 compaction、prune、retrieval 或预算策略。

以下策略属于未来 context 设计：

- compaction / prune / summary；
- tail window 与 working set；
- artifact / retrieval；
- Context Manifest 与 token budget 解释。

`model_input` 原样消费 messages，不实现这些策略。未来 context 即使增加 manifest，也由 loop 取出 messages 后调用 `compile`；manifest 不进入 `ModelRequest`。

context 设计时需要考虑 system 与 tools 的 pinned token 成本，但本文不预设 budget object、token counter trait 或 materialize 返回结构。

---

## 6. Tool 与 permission 边界

```text
agent-tools catalog
       ↓ build
ToolRegistry（spec + executor + validator）
       ├──► model_input：读取 spec，生成 ModelRequest.tools
       └──► loop：resolve → validate input → permission check → execute
```

- schema 与 executor 必须来自同一个冻结 `Tool`；
- `model_input` 精确复制 canonical schema，不做 provider 关键词转换；
- permission 是 `agent` 声明的 `tool_name → Allow | Ask` map，由 loop 查表；
- 缺失 permission 安全拒绝；当前不建立独立 permission 模块；
- 并发、资源 claim、retry 与 offload 属于 scheduler。

---

## 7. 错误与恢复边界

| 失败 | Owner | 行为 |
|------|-------|------|
| request model/messages/max_tokens 非法 | `llm` preflight | `LlmError` 返回 run 边界 |
| tool input 不匹配 schema | `tools` + `loop` | 产生可配对 `InvalidArguments` 结果，不调用 executor |
| permission 未声明或拒绝 | `loop` | 产生明确拒绝结果 |
| executor 基础设施错误 | `tools` 向上传播，`loop` 配对 | 先记录 `OutcomeUnknown`，再传播原错误 |
| session 文件/不变量损坏 | `session` | `anyhow::Result` 传播，不部分恢复 |

REPL turn 的可恢复错误由 run 边界打印后继续；配置类致命错误可以终止启动。

---

## 8. Conformance

不能只靠文档声明的边界必须有测试守门：

1. `model_input` 字段映射完整，messages 和 JSON Schema 不改写；
2. invalid request config 仍可 compile，拒绝只发生在 llm preflight；
3. frozen registry 的 schema 与 dispatch executor 来自同一 `Tool`；
4. Session Item Log 的 seq、身份和 call/result 配对可恢复；
5. event derive 不写回 session；
6. 未来 loop 集成测试证明 `SystemPrompt` 每 user turn 解析一次，并且 runtime 只经 `model_input::compile` 构造请求。

每个测试注释必须说明场景、预期结果和不变量/副作用约束。热路径不增加 runtime assert 替代结构测试。

---

## 9. 文档地图

| 主题 | 当前文档 |
|------|----------|
| 工程规则与权威顺序 | [`engineering-handbook.md`](engineering-handbook.md) |
| 内核模块进度 | [`../agent-core/README.md`](../agent-core/README.md) |
| LLM | [`../agent-core/src/llm/DESIGN.md`](../agent-core/src/llm/DESIGN.md) |
| Session | [`../agent-core/src/session/DESIGN.md`](../agent-core/src/session/DESIGN.md) |
| Tools | [`../agent-core/src/tools/DESIGN.md`](../agent-core/src/tools/DESIGN.md) |
| Event | [`../agent-core/src/event/DESIGN.md`](../agent-core/src/event/DESIGN.md) |
| Model input | [`../agent-core/src/model_input/DESIGN.md`](../agent-core/src/model_input/DESIGN.md) |
| Context | [`../agent-core/src/context/README.md`](../agent-core/src/context/README.md) · [`../agent-core/src/context/DESIGN.md`](../agent-core/src/context/DESIGN.md) |

`context` 当前已有 R1 架构/实现设计文档；`loop`、`scheduler` 仍在各自架构对齐完成前不建立实现级当前文档。
