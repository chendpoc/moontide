# MoonTide Rust 工程手册

> **状态：** 当前参考（Rust 版，持续重建）。
> **范围：** Rust workspace、`agent-core` 内核模块、跨模块工程约束。
> **运行时权威：** [`../../AGENTS.md`](../../AGENTS.md)。本手册提供详细解释、判据、示例和审查方法，不得放宽 `AGENTS.md` 的硬约束。
> **历史版本：** TypeScript 时代手册位于 [`../../docs/archive/guides/engineering-handbook.md`](../../docs/archive/guides/engineering-handbook.md)，仅供追溯。

---

## 1. 文档分层与权威顺序

MoonTide 使用“短规则注入、长规则落盘、模块规则就近”的文档分层：

```text
AGENTS.md
  runtime 必需、每 turn 注入、可执行的硬约束
        │
        ▼
crates/docs/engineering-handbook.md
  Rust 工程规则的完整解释、判据、示例、Conformance 方法
        │
        ├── crates/docs/*.md（标记为“当前”的文档）
        │     Rust 系统级 owner、边界和不变量
        └── crates/agent-core/src/*/{README,DESIGN}.md
              模块局部 API、实现方案、不变量和测试方向
```

`docs/spec/` 与 `docs/notes/` 都是候选、draft、调研或迁移材料，不参与当前 Rust 契约的权威裁决。`crates/docs/` 中每份文档必须在开头标明“当前”或“候选”；候选文件不能因为标题写了“定稿”就覆盖当前设计。

发生冲突时按以下顺序处理：

1. `AGENTS.md`；
2. 本 handbook；
3. `crates/docs/` 中标记为当前的 Rust 系统设计；
4. 模块 `README.md` / `DESIGN.md`；
5. `TODO.md`（只决定执行优先级，不覆盖架构）；
6. `docs/spec/`、`docs/notes/` 与其他候选设计；
7. `docs/archive/` 历史材料。

模块文档若与 handbook 或当前 Rust 系统设计冲突，应先修正边界和入口，不以局部文档悄悄改变系统契约。

---

## 2. Rust workspace 分层

当前目标结构是：

```text
cli（纯壳）→ agent（组合根）
               ├──► agent-core（引擎：llm / session / tools / event / model_input / context / loop / scheduler）
               └──► agent-tools（第一方 catalog / builtins）──► agent-core
```

### 2.1 分层职责

| 层 | 负责 | 不负责 |
|----|------|--------|
| `cli` | 参数、REPL、渲染、退出码 | Agent 内核逻辑、provider 组装 |
| `agent-core` | 生命周期、协议、状态、工具和调度内核 | CLI 细节、厂商 preset、sidecar 进程管理 |
| `agent-tools` | 第一方 `ToolDefinition` catalog、spec 与 executor 实现 | runtime registry、permission、loop 编排 |
| `agent` | 组合根、preset、provider、runtime 注入 | 在 loop 内硬编码 endpoint 或工具表 |
| `sidecar` / runtime | 进程外扩展和隔离 | 直接绕过内核 permission |

`agent-core` 的八个模块是同一 crate 内的内部 mod，不为了目录好看提前拆 crate。只有出现真实的跨二进制共享契约或独立发布需求时，才重新评估拆分。

### 2.2 当前推进状态

以 [`.agents/skills/moontide-kernel-plan/PROGRESS.md`](../../.agents/skills/moontide-kernel-plan/PROGRESS.md) 为准。当前已完成或正在推进的模块仍必须以代码和模块文档为证，不以 roadmap 表格单独宣称完成。

---

## 3. 依赖方向与可见性

依赖只能向下或向稳定契约流动，低层模块不能反向 import 编排层：

```text
llm ───────────────► provider / protocol
session ───────────► llm protocol + tools result status + event commit seam
tools ──────────────► std + serde + anyhow
event ──────────────► protocol / TurnEvent + tools result status
model_input ────────► tools + llm protocol
context ────────────► session + llm protocol + tools
loop ───────────────► llm + session + tools + event + model_input + context
scheduler ──────────► llm + tools
```

约束：

- `session` 不依赖 `loop` 或 `agent`；
- `tools` 不依赖 `loop`、`scheduler`、`session`、`event` 或 `llm` 的实现；
- `session` / `event` 如需持久化 tool status，只依赖 `tools` 的稳定结果契约，不依赖 tools 的 executor/registry 实现；
- `event` 不拥有 SessionStore；AgentLoop 每次 emit 短借它独占持有的 mutable commit target；
- `loop` 持有 SessionStore，但运行时只经 `event::EventDispatcher::emit` 提交事实，不直接 `commit_item`；
- 模块内部项不加 `pub`；crate 内共享使用 `pub(crate)`；跨 crate 才公开；
- 不用 trait 表达单实现或未来可能扩展的结构。

### 3.1 Trait 使用纪律

Trait 的约束是“是否形成清晰的实现边界”，不是数量上限。只有满足至少一个条件时才引入 trait：

- 存在多个独立实现或运行时替换需求；
- 需要把实现 owner 与调用方隔离；
- 需要稳定的测试替身或动态装配 seam；
- trait 的方法集合可以用一句话描述且保持窄小。

不要为单实现的本地逻辑、数据容器或“未来可能扩展”提前抽象。trait 的数量本身不是架构质量指标。

| Trait | 用途 | 实现来源 |
|-------|------|----------|
| `LLMProvider` | 流式模型调用边界 | 云端 provider / 本地 daemon |
| `ToolExecutor` | 单个工具真实副作用边界 | 内置工具 / sidecar adapter |
| `HookHandler` | post-commit、fail-open 的扩展 callback | Agent Event / UI / sidecar / metrics |
| `CommitHandler` | 将 committable TurnEvent 写入事实源的短期 mutable seam | SessionStore |

Hook 不返回 Block/approval/cancel/retry 决策；原 ObserveHandler 合并为 Hook。CommitHandler 不放进 registry，也不通过 Arc/Mutex 长期持有。新增 trait 需要说明实现 owner、生命周期、替换理由和测试 seam。

---

## 4. Spec / Impl 分离与声明式 Registry

凡同时存在“对外契约”和“运行时副作用”的能力，必须物理分离：

```text
spec.rs
  ToolSpec / schema

impl.rs
  handler / executor / IO / subprocess / network

registry.rs
  declaration → implementation 的绑定与冻结

agent 组合配置
  ToolPermissionMap: tool-name → Allow | Ask
```

### 4.1 硬判据

问下面两个问题：

1. 改执行算法、超时或错误文案时，是否不需要修改模型 schema？
2. 改 schema、权限或注册表条目时，是否不需要修改 IO 细节？

任一答案为“否”，说明 spec 和 impl 耦合过深，应拆分。

### 4.2 Tools 特别规则

`ToolSpec` 是纯声明；schema 不执行 IO；`ToolExecutor` 是唯一副作用端口；`ToolRegistry` 只负责稳定绑定和 lookup。

一个 LLM step 使用冻结的 registry snapshot：

```text
ModelRequest.tools 中由 ToolSpec 映射的 schema
       ==
实际 dispatch 使用的 ToolExecutor
```

动态工具或 MCP 工具的增删在下一 step 的新 snapshot 生效，不能让当前 `ModelRequest.tools` 与实际执行器漂移。

`agent` 组合根声明 ToolPermissionMap 与 approval handler，`loop::ToolRuntime` 校验其 key 集并处理 `Ask`；当前不设独立 permission 模块。Loop R1 顺序执行 calls 并负责 Turn cancellation；scheduler 后置负责资源并发、tool retry 与 offload/failover。tools 只负责单次调用。

`ToolCall` 与 `ToolResult` 是单次调用生命周期仅有的两个结构体建模。executor 直接返回 `ToolResult`；event/session 只包装它们，不复制 id/name/input/status/content 字段组。`ToolResultStatus` 是 host 侧规范状态，`Failed { retryable }` 不得丢失；LLM `ContentBlock::ToolResult` 仍只承载模型可见 content，控制流不得从 content 反推 status。结构化结果统一使用 `ToolContent::Json`，不重复维护 host-only 载荷。`ToolContent` 的持久化必须带显式 `type` tag，不能用会混淆 Text 与 JSON string 的 untagged 表示。

### 配置所有权与 runtime 解析

可配置策略必须有明确的声明式配置入口，不应通过扩大局部常量作用域来“暴露配置”。权限策略推荐分为两层：

```text
声明式 Policy / Rules
  → 启动时解析与校验
  → ToolPermissionMap
  → ToolRuntime 按工具名查询
```

声明层可以使用规则数组或高层 policy，例如 `Default`、`AlwaysAsk`、
`AlwaysAllow`、`AllowList`；runtime 层使用确定性的
`BTreeMap<tool_name, Allow | Ask>`。resolver 必须校验规则无重复、工具集合
完全匹配，且不能因为 `AlwaysAllow` 跳过工具存在性或 input schema 校验。

`ToolSpec` 描述工具能力，不固化当前宿主、入口或用户的最终 permission；
同一个工具可以在 CLI、Desktop、自动化或只读模式下拥有不同策略。高层
policy 应在组合根解析，`ToolRuntime` 只应用最终的 `Allow` / `Ask` 决策。

canonical 工具名匹配 `^[A-Za-z0-9_-]{1,64}$`。工具 schema 使用固定的 JSON Schema Draft 2020-12；R1 只保留 `input_schema`，其顶层 JSON 值必须是 object，object 内的 schema 文档在注册时校验，调用 input 在执行前校验。`output_schema` 等出现明确结构化消费者后再设计。

详见 [`agent-core/src/tools/README.md`](../agent-core/src/tools/README.md) 与 [`agent-core/src/tools/DESIGN.md`](../agent-core/src/tools/DESIGN.md)。

---

## 5. Runtime 数据流与事实边界

一次 Turn 的核心数据流：

```text
Session Item Log
    │ preflight materialize + next_turn + commit UserMessage
    │ materialize
    ▼
Context / messages
    │ model_input::compile
    ▼
ModelRequest
    │ LLMProvider
    ▼
ModelResponse / ToolUse
    │
    ├─ ToolUse response → commit all ToolCall before side effects
    │       → input validation → permission/approval → ToolExecutor
    │                                                               │
    │                                                               ▼
    │                                                           ToolResult
    │
    ├─ loop emit TurnEvent
    └─ event commit / derive
```

### 5.1 Session Item Log

Session Item Log 是整场 session 的 append-only 事实源，负责回答：

```text
模型请求了什么？
工具产生了什么结果？
```

它可以被 resume、replay 和 `context.materialize` 消费。Session 是唯一写者；运行时模块不直接写 JSONL。

### 5.2 Agent Event Log

Agent Event Log 是由 `TurnEvent` derive 的观测记录，服务于诊断、sidecar 和后续指标。它不是恢复事实源，也不能反向修改 Session Item Log。

`agent-core::event` 只拥有 `TurnEvent`、derive、`AgentEventRecord` 和
`AgentEventRecorder` port；`agent::log` 拥有 bounded queue、worker、persistence policy
和 file recorder。queue 中保留完整 canonical payload，
只有落盘阶段才允许 JSONL 限制、truncate、preview 或简化。队列溢出只统计
`dropped_events`，不引入 `dropped_bytes` 或 byte-budget queue。

默认 policy 是 `SessionPersistence::Items + DiagnosticPersistence::Off`：Session
Item Log 正常写入，默认不注册 Agent Event Hook、不启动 diagnostic worker，也不创建
runs 文件；当前实时宿主事件由 Progress 提供。启用 `Errors`、`Normal` 或 `Debug` 时，
`agent::log` 才注册 post-commit hook 并创建 active JSONL。
完整的三流、路径和 settings 契约见
[`logging-and-session-design.md`](logging-and-session-design.md)。

### 5.3 Tool-call round closure

一次 ToolUse 响应中的全部 `ToolCall` 是一个 round。Loop R1 在任何副作用前按模型顺序提交全部 calls，再顺序执行并提交每个 result；下一 Step 前 round 必须全量闭合。`context` 只验证已有 Session Item Log 的闭合条件。executor Err/执行中取消的当前 result 是 OutcomeUnknown，未开始 sibling 是 Cancelled(Parent)。并发、资源 claim、deadline 与 tool retry 留给 scheduler 设计。

### 5.4 Turn / Step

执行层级固定为 Session → Turn → Step → Tool round，不使用领域 Run。AgentLoop 独占 non-Clone SessionStore，`turn(&mut self)` 串行化同实例；R1 不提供跨实例 Session lease。

一个 Step 是一次逻辑 LLM 调用。Recoverable retry 使用同一 ModelRequest/Step 和新的 llm_call_id；默认初次后重试 3 次，固定 cancellation-aware backoff 500 ms、1 s、2 s。Turn 主动取消直接使用 CancellationToken，不增加 TurnCancellation wrapper。

术语固定为：

| 过程 | 规范用词 |
|------|----------|
| Session Item Log → messages | `materialize` |
| SystemPrompt + messages + tools → ModelRequest | `compile` |
| TurnEvent → Agent Event | `derive` |

---

## 6. 错误、取消与副作用

### 6.1 两类错误边界

| 类型 | 表达 | 处理 |
|------|------|------|
| 工具预期失败 | 模型可见的 tool result | 返回错误文本/结构化结果，通常继续 turn |
| 工具基础设施故障 | `anyhow::Result` | loop 先提交 `OutcomeUnknown` 配对结果，再向 turn 边界传播原始错误 |
| LLM 基础设施故障 | `anyhow::Result` | 向 turn 边界传播，统一处理 |

预期失败不得 panic；基础设施错误不得在中途吞掉。库代码不用 `unwrap()`、`expect()` 或 panic 处理外部输入。

### 6.2 取消与结果未知

取消原因和请求失败是两个正交维度。R1 至少区分：

- 用户取消；
- 父任务取消；
- runtime disposed；
- 工具尚未开始；
- 工具已经开始但副作用结果未知。

Hook 不能阻断或取消。工具已开始且无法确认写入结果时使用 OutcomeUnknown；剩余未开始 sibling calls 使用 Cancelled(Parent)。loop 先提交全部配对结果，再传播取消/原错误。

### 6.3 TurnEvent 与 Session 顺序

对于 tool 调用，推荐并由 event/session 契约守门的顺序是：

```text
AssistantFinalized                    # 每个成功 call 一次；tool-only 可为空 marker
  → ToolCallRecorded { call 0..N }   # 全部 call 先记录
  → for each call in model order:
      input validation / permission / approval
      → ToolExecutor
      → ToolResultRecorded { result }
```

执行副作用前必须使整个 round 的 ToolCall 事实可恢复；结果完成后逐条提交 ToolResult。executor 返回基础设施错误时，loop 先提交当前 OutcomeUnknown 和剩余 Parent-cancelled results，再传播原始错误。最后允许 Step 返回 ToolUse 时也必须闭合 round，再返回 step-limit error。

每个 LLM attempt 都必须产生一次 `LlmCallEnded`，其 outcome 使用 typed enum 表达成功、请求失败、无效响应或取消；详细 provider 错误只进入 logger。tool-only response 的 `AssistantFinalized` 空 marker 用于关闭运行时 draft，不写入 Session Item Log；非空 assistant blocks 才形成 `AssistantMessage`。

---

## 7. 测试与 Conformance

### 7.1 测试注释

每个 `#[test]` / `#[tokio::test]` 前必须说明：

1. 场景：输入、状态或故障条件；
2. 预期：结果、状态或错误边界；
3. 不变量 / 副作用：例如 executor 不得被调用、不得写 Session、调用身份必须保持。

测试注释描述要守门的架构契约，不写成函数调用流水账。测试行为改变时，注释必须同步更新。硬约束见 [`../../AGENTS.md`](../../AGENTS.md)。

### 7.2 结构测试

以下边界不能只写在 README，必须有结构测试或等价静态守门：

- 工具名唯一，Registry 顺序稳定，snapshot 冻结；
- spec 文件不包含 IO 副作用；
- handler 不定义模型 schema；
- `session` 不 import `loop` / `agent`；
- `tools` 不 import 高层运行时实现；
- loop 不直接 `commit_item`；EventDispatcher/registry 不拥有 SessionStore；
- Committable TurnEvent 才能进入 commit 阶段；
- Committable event 的 Hook 只在 commit 成功后运行；Hook 全部 fail-open 且没有 Block/approval/cancel 返回值；
- ToolResult 状态与 content 独立；
- 单次工具生命周期只用 ToolCall / ToolResult 建模，event/session 直接包装，不复制字段；
- `OutcomeUnknown` 不得归一成成功；
- executor `Err` 必须先产生一次配对的 `OutcomeUnknown`，再向 turn 边界传播。
- 一个 Tool round 的全部 calls 必须在任何 executor 前提交，并在 cancel/error 后全量配对；
- LLM retry 保持同一 Step/ModelRequest，每个 attempt 使用新 llm_call_id。

Conformance 测试验证不变量；热路径不增加 runtime assert 来替代测试。

### 7.3 验证命令

代码改动后执行：

```text
just check
  = cargo fmt --all --check
  + cargo clippy --workspace --all-targets
  + cargo test --workspace
```

只改单个 crate 时可以先运行 `cargo test -p <crate>`，但交付前仍应补 workspace 检查。文档-only 变更不强制运行 Cargo 检查，但必须做链接、格式和 diff 审查。

---

## 8. Git 与变更边界

- 提交只包含当前会话改动的显式路径；禁止 `git add -A` / `git add .`。
- 提交前检查 `git status`，确认没有纳入其他会话的文件。
- 提交信息格式：`{feat,fix,docs}[(scope)]: <message>`。
- 不运行 `git reset --hard`、`git checkout .`、`git clean -fd`、`git stash` 或 force push。
- 未经用户要求不提交；用户要求提交时，先审查 staged diff 再提交。
- 代码产物只进入 `target/`，不提交构建产物。

架构变更应优先拆成“契约/设计 → 实现 → 测试”几个 review 批，不把未确认的未来模块一起实现。

---

## 9. 术语与命名

### 9.1 Canonical 术语

| 领域 | 规范名称 |
|------|----------|
| 整场 session 的 append-only 事实源 | **Session Item Log** |
| log 中的一条记录 | **SessionItem** |
| 现有 `runId` 分区的观测日志 | **Agent Event Log**（legacy 字段，不是 Run 实体） |
| 运行事件分派 | **TurnEvent dispatch** |
| turn 配置解析 | `resolveTurnConfig` |
| turn 上下文解析 | `resolveTurnContext` |
| 执行层级 | Session → Turn → Step → Tool round（无领域 Run） |

### 9.2 禁用替代词

- 不用 `Session Event Log`、`SessionLog`、`Item Log` 代替 Session Item Log；
- 不用 `derive_messages`、`projection`、`restore` 代替 `materialize`；
- 不用 `compose` 代替 `compile`；
- 不用 `bus` / `sink` 指 TurnEvent dispatch；异步观测使用 `ObserverBridge`，sidecar transport 另行命名；
- 不用“工具验收网关”描述 tools 的核心职责；模型 offload 验收属于 scheduler。

命名的目标是一词一义，并能对应具体模块、边界或不变量。

---

## 10. 手册维护与架构门禁

### 10.1 什么时候改哪里

| 变更 | 必须更新 |
|------|----------|
| 新增每 turn 必须遵守的硬规则 | `AGENTS.md` + 本手册对应章节 |
| 改八模块职责或 import 边界 | 本手册 + [`agent-core.md`](agent-core.md) + 受影响模块 DESIGN |
| 改单个模块 API / 不变量 | 模块 `README.md` / `DESIGN.md` |
| 改候选方案 | 候选文档，并注明未实现 |
| 完成一个模块实现 | 模块文档 + `PROGRESS.md` + 测试证据 |

### 10.2 设计确认门

在实现前必须先确认：

1. 目标和非目标；
2. owner、依赖方向和公开类型；
3. 失败、取消和恢复语义；
4. 结构测试和验收证据；
5. 实现批次和变更边界。

未确认的候选设计放在 notes 或候选文档，不写成当前实现承诺。手册的作用是减少架构漂移，不是替代设计确认。
