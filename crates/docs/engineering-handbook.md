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
session ───────────► llm protocol + tools result status
tools ──────────────► std + serde + anyhow
event ──────────────► protocol / RunEvent + tools result status
model_input ────────► tools + llm protocol
context ────────────► session + llm protocol
loop ───────────────► llm + session + tools + event + model_input + context
scheduler ──────────► llm + tools
```

约束：

- `session` 不依赖 `loop` 或 `agent`；
- `tools` 不依赖 `loop`、`scheduler`、`session`、`event` 或 `llm` 的实现；
- `session` / `event` 如需持久化 tool status，只依赖 `tools` 的稳定结果契约，不依赖 tools 的 executor/registry 实现；
- `event` 不拥有 Session Store；commit handler 由组合根装配；
- `loop` 只经 `event::EventDispatcher::emit` 发送事件，不直接写 Session；
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
| `HookHandler` | event 提交前的阻断 callback | run / lifecycle guard |
| `CommitHandler` | 将 committable RunEvent 写入事实源 | session adapter |
| `ObserveHandler` | 派生 Agent Event Log 或观测输出 | event observer / sidecar |

这些 trait 属于不同的窄边界，不互相替代，也不应合并成一个通用 service trait。新增 trait 需要说明实现 owner、生命周期、替换理由和测试 seam。

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

`agent` 组合根声明 `ToolPermissionMap`，`loop` 只负责按 tool name 查表并处理 `Ask`；当前不为这一次查询设独立 permission 模块。scheduler 负责“何时执行、如何并行、如何取消”；tools 只负责单次调用。模型 offload、验收、retry、failover 不属于 tools。

`ToolCall` 与 `ToolResult` 是单次调用生命周期仅有的两个结构体建模。executor 直接返回 `ToolResult`；event/session 只包装它们，不复制 id/name/input/status/content 字段组。`ToolResultStatus` 是 host 侧规范状态，`Failed { retryable }` 不得丢失；LLM `ContentBlock::ToolResult` 仍只承载模型可见 content，控制流不得从 content 反推 status。结构化结果统一使用 `ToolContent::Json`，不重复维护 host-only 载荷。`ToolContent` 的持久化必须带显式 `type` tag，不能用会混淆 Text 与 JSON string 的 untagged 表示。

canonical 工具名匹配 `^[A-Za-z0-9_-]{1,64}$`。工具 schema 使用固定的 JSON Schema Draft 2020-12；R1 只保留 `input_schema`，其顶层 JSON 值必须是 object，object 内的 schema 文档在注册时校验，调用 input 在执行前校验。`output_schema` 等出现明确结构化消费者后再设计。

详见 [`agent-core/src/tools/README.md`](../agent-core/src/tools/README.md) 与 [`agent-core/src/tools/DESIGN.md`](../agent-core/src/tools/DESIGN.md)。

---

## 5. Runtime 数据流与事实边界

一次 run 的核心数据流：

```text
Session Item Log
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
    ├─ ToolCall → input validation → loop permission-map check → ToolExecutor
    │                                                               │
    │                                                               ▼
    │                                                           ToolResult
    │
    ├─ loop emit RunEvent
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

Agent Event Log 是由 RunEvent derive 的观测记录，服务于 UI、诊断、sidecar 和指标。它不是恢复事实源，也不能反向修改 Session Item Log。

术语固定为：

| 过程 | 规范用词 |
|------|----------|
| Session Item Log → messages | `materialize` |
| SystemPrompt + messages + tools → ModelRequest | `compile` |
| RunEvent → Agent Event | `derive` |

---

## 6. 错误、取消与副作用

### 6.1 两类错误边界

| 类型 | 表达 | 处理 |
|------|------|------|
| 工具预期失败 | 模型可见的 tool result | 返回错误文本/结构化结果，通常继续 turn |
| 工具基础设施故障 | `anyhow::Result` | loop 先提交 `OutcomeUnknown` 配对结果，再向 run 边界传播原始错误 |
| LLM 基础设施故障 | `anyhow::Result` | 向 run 边界传播，统一处理 |

预期失败不得 panic；基础设施错误不得在中途吞掉。库代码不用 `unwrap()`、`expect()` 或 panic 处理外部输入。

### 6.2 取消与结果未知

取消原因和请求失败是两个正交维度。至少区分：

- 用户取消；
- 父任务取消；
- hook 阻断；
- runtime disposed；
- 工具尚未开始；
- 工具已经开始但副作用结果未知。

工具已开始且无法确认写入结果时，使用 `OutcomeUnknown`，不能为了让对话继续而伪造 `Succeeded` 或 `Failed`。

### 6.3 RunEvent 与 Session 顺序

对于 tool 调用，推荐并由 event/session 契约守门的顺序是：

```text
AssistantFinalized
  → ToolCallRecorded { call }
  → input validation / loop permission-map check
  → ToolExecutor
  → ToolResultRecorded { result }
```

执行副作用前必须使 `ToolCall` 事实可恢复；结果完成后再提交 `ToolResult` 事实。executor 返回基础设施错误时，loop 也必须先提交一个 `OutcomeUnknown` result，再传播原始错误，不能留下已记录但无结果的 call。scheduler 后续作为多调用外层编排接入，不是当前单次调用的第三道门禁。

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
- loop 不直接写 Session；
- Committable RunEvent 才能进入 commit 阶段；
- ToolResult 状态与 content 独立；
- 单次工具生命周期只用 ToolCall / ToolResult 建模，event/session 直接包装，不复制字段；
- `OutcomeUnknown` 不得归一成成功；
- executor `Err` 必须先产生一次配对的 `OutcomeUnknown`，再向 run 边界传播。

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
| 单次 run 的观测日志 | **Agent Event Log** |
| 运行事件广播 | **RunEvent bus** |
| run 配置解析 | `resolveRunConfig` |
| turn 上下文解析 | `resolveTurnContext` |

### 9.2 禁用替代词

- 不用 `Session Event Log`、`SessionLog`、`Item Log` 代替 Session Item Log；
- 不用 `derive_messages`、`projection`、`restore` 代替 `materialize`；
- 不用 `compose` 代替 `compile`；
- 不用 `sink` 指 RunEvent bus；
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
