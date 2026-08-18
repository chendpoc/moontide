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
| `session` | Session Item Log 的 create/load/commit/fork 与恢复不变量 | llm/tools 契约 + event commit seam | 已实现；Loop 接缝增量待做 |
| `tools` | ToolSpec、Tool、冻结 registry、input validation、单次执行 | 基础库 | 已实现 |
| `event` | TurnEvent、dispatcher、derive、Agent Event recorder | llm/tools 契约 | 当前分期已实现；完整 bus 后置 |
| `model_input` | provider-neutral `ModelRequest` 的纯组装 | llm protocol + tools | R1 已实现并完成测试 |
| `context` | Session Item Log → model-visible messages 的 `materialize` | session + llm protocol + tools | R1 已实现、测试并通过 Review |
| `loop` | AgentLoop ownership、Turn/Step/tool round、permission/approval、LLM retry 与 Turn cancellation | 模块 1–6 | R1–R3 + conformance 已实现 |
| `scheduler` | 后置的资源排队、并发、tool retry、delegate/offload | llm + tools | 后置 |

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
       └────────────── TurnEvent / derive ─────────────► Agent Event Log
```

- **Session Item Log** 是可恢复事实源，`session` 是唯一写者；
- **Agent Event Log** 是由 `TurnEvent` derive 的观测记录，不反向覆盖 session；当前 `runId` 仅为 legacy 分区键，不构成 Run 实体；
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

`context` R1 已将输入输出边界落在模块 README/DESIGN，实现与测试已通过 Review：

```text
Session Item Log ──context::materialize──► model-visible Vec<Message>
```

```rust
pub(crate) fn materialize(
    items: &[SessionItem],
) -> anyhow::Result<Vec<Message>>;
```

R1 直接映射普通 user/assistant items，聚合连续 tool call/result，忽略 checkpoint metadata；遇到 `Compaction`、未配对的 tool call/result 或身份不一致时返回错误。一个连续 ToolCall 段是一次 round；所有 call 都有配对的 ToolResult 后才能进入下一 model Step。context 只验证这一闭合条件。Loop R1 已确认先记录全部 calls、顺序执行并全量配对；并发、资源 claim、deadline 与 tool retry 后置给 scheduler。该函数只读，不写回 session，也不拥有 compaction、prune、retrieval 或预算策略。

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
- registry/map key 集由 `ToolRuntime::new` 校验；存在 Ask 时必须有显式 `ToolApprovalHandler`；
- Hook 不参与 permission 或 approval；
- R1 顺序执行 calls，Turn cancellation 归 loop；并发、资源 claim、tool retry 与 offload 属于 scheduler。

---

## 7. Loop 边界

执行领域模型只有：

```text
Session → Turn → Step → Tool round
```

Run 已删除。Agent Event 中的 `runId` 是 legacy 观测分区字段，不参与执行、取消或返回值；OTel trace/span 后置独立设计。

### 7.1 Ownership 与入口

`agent` create/load/fork Session，并构造 provider、ToolRuntime 与 EventDispatcher，然后通过一次性 `AgentLoopInit` 转移所有权。AgentLoop 长期持有 non-Clone SessionStore，`turn(&mut self)` 串行化同实例 Turn。

```rust
pub struct AgentLoopInit {
    pub session: SessionStore,
    pub provider: Arc<dyn LLMProvider>,
    pub tools: ToolRuntime,
    pub events: EventDispatcher,
}

pub async fn turn(
    &mut self,
    input: TurnInput,
    cancellation: tokio_util::sync::CancellationToken,
) -> anyhow::Result<ModelResponse>;
```

R1 不增加 OS Session lease；两个独立 AgentLoop 同时 load 同一 session 属于不支持用法。EventDispatcher 不长期持有 commit target，每次 emit 短借 `&mut SessionStore`。

### 7.2 Turn 与 Step

- 新 UserMessage 前先 materialize 已有 facts；非法/dangling history 拒绝且不 append；
- turn number 由 `SessionStore::next_turn` 计算，调用者不传；UserMessage commit 后永久消费；
- Step 从 0 开始且受 `max_steps` 限制；
- LLM retry 是同一 Step 的 attempt，不增加 Step，不重新 compile；默认 retry 3 次；
- Terminal response 直接返回 ModelResponse，不增加 RunResult/TurnOutcome；
- 最后允许 Step 返回 ToolUse 时，先闭合全部 call/result，再报 step exhaustion；
- Turn 错误不回滚事实，只要后续 materialize 成功，AgentLoop 可继续下一 Turn。

### 7.3 Tool round

一个 ToolUse response 的全部 calls 在任何副作用前按模型顺序 commit，然后顺序执行 `resolve → validate → permission/approval → execute → result commit`。所有 calls 均有且仅有一个 result 后才能进入下一 Step。

executor Err 或执行中取消：当前 call `OutcomeUnknown`，未开始 sibling calls `Cancelled(Parent)`，全部 commit 后传播原错误/取消。执行前取消：当前 `Cancelled(User)`，剩余 `Parent`。

### 7.4 Hook

Hook 是 post-commit、fail-open 的扩展 callback，只读 TurnEvent/TraceContext。原 ObserveHandler 合并为 Hook，原 HookOutcome::Block 删除；Agent Event derive/recorder/storage/file writer 保留。permission、cancel、retry、config 和 scheduler 使用显式 API，不通过 Hook 决策。

---

## 8. 错误与恢复边界

| 失败 | Owner | 行为 |
|------|-------|------|
| request model/messages/max_tokens 非法 | `llm` preflight | `LlmError` 返回 turn 边界 |
| tool input 不匹配 schema | `tools` + `loop` | 产生可配对 `InvalidArguments` 结果，不调用 executor |
| permission 未声明或拒绝 | `loop` | 产生明确拒绝结果 |
| executor 基础设施错误 | `tools` 向上传播，`loop` 配对 | 先记录 `OutcomeUnknown`，再传播原错误 |
| LLM Recoverable 请求错误 | `loop` | 同一 Step/ModelRequest 内默认重试 3 次，固定 cancellation-aware backoff |
| Turn cancellation | `loop` | 用 CancellationToken 打断等待；先闭合已记录 tool round，再返回取消 |
| session 文件/不变量损坏 | `session` | `anyhow::Result` 传播，不部分恢复 |

REPL turn 的可恢复错误由 turn 边界打印后继续；配置类致命错误可以终止启动。

---

## 9. Conformance

不能只靠文档声明的边界必须有测试守门：

1. `model_input` 字段映射完整，messages 和 JSON Schema 不改写；
2. invalid request config 仍可 compile，拒绝只发生在 llm preflight；
3. frozen registry 的 schema 与 dispatch executor 来自同一 `Tool`；
4. Session Item Log 的 seq、身份和 call/result 配对可恢复；
5. event derive 不写回 session；
6. 未来 loop 集成测试证明 `SystemPrompt` 每 user turn 解析一次，并且 runtime 只经 `model_input::compile` 构造请求。
7. AgentLoop 独占 SessionStore；EventDispatcher/registry 不拥有 commit target；
8. Hook 在 commit 后运行、全部 fail-open，且不能返回 Block/approval/cancel；
9. retry 保持 Step 与 ModelRequest，attempt 使用不同 llm_call_id；
10. 一个 Tool round 的全部 calls 先于副作用记录，并在所有错误/取消路径全量配对。

每个测试注释必须说明场景、预期结果和不变量/副作用约束。热路径不增加 runtime assert 替代结构测试。

---

## 10. 文档地图

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
| Loop | [`../agent-core/src/loop/README.md`](../agent-core/src/loop/README.md) · [`../agent-core/src/loop/DESIGN.md`](../agent-core/src/loop/DESIGN.md) |
| Agent composition root | [`../agent/README.md`](../agent/README.md) · [`../agent/DESIGN.md`](../agent/DESIGN.md) |
| CLI shell | [`../cli/README.md`](../cli/README.md) · [`../cli/DESIGN.md`](../cli/DESIGN.md) |

`loop` R1–R3 与 TASK-loop-06 已完成；`agent` 与 CLI 宿主基线已实现并通过测试，当前进入 Desktop Shell 宿主能力建设；流式 UI、Session query 和 Desktop 生命周期接缝后置于核心 R1，但属于当前宿主主线。OTel 与 `scheduler` 暂缓，不建立实现级当前文档。
