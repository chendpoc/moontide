# MoonTide 能力模型

> **性质：** Product capability model
> **状态：** Confirmed analysis baseline；具体能力的实现阶段仍以 `plan.md`、`desktop-development-direction.md` 和各模块契约为准
> **目的：** 从用户目标定义 MoonTide 应具备的能力，再推导行为、功能、架构和验收

本文不是功能清单，也不是实现 TODO。它描述 MoonTide 作为 coding agent product 需要具备的能力、边界和演进方向。

## 1. 能力模型的使用规则

能力模型与竞品功能的关系是：

```text
用户目标
  ↓
MoonTide capability
  ↓
行为契约与状态边界
  ↓
具体 CLI / Desktop 功能
  ↓
实现与验收
```

竞品调研回答：

> 其他产品如何解决类似问题？它们的调用机制、治理方式和代价是什么？

能力模型回答：

> MoonTide 自己必须具备什么能力？谁拥有它？在什么阶段实现？如何证明它工作？

功能清单只能作为能力模型的派生视图，不能直接成为路线图。

## 2. 产品目标

MoonTide 的当前产品目标是：

> 在本地工作区中，以可观察、可控制、可恢复的方式完成 coding task。

“完成 coding task”至少包括：

- 理解当前项目和用户意图；
- 获取足够上下文；
- 通过工具读取和修改工作区；
- 执行测试、构建或其他验证；
- 在危险操作前遵守权限边界；
- 记录可恢复的事实；
- 在失败、取消或中断后保持明确状态。

当前产品不等于“拥有所有成熟 agent 产品功能”。成熟产品方向中的 Remote Compute、multi-agent、memory、scheduler、plugins 和跨设备能力必须由真实需求推动。

## 3. 能力总览

```text
                         ┌────────────────────────┐
                         │ Product / Host Surfaces │
                         │ CLI · Desktop · SDK    │
                         └───────────┬────────────┘
                                     │ intent / render
                         ┌───────────▼────────────┐
                         │ Agent Task Execution   │
                         │ Turn · Step · Tool     │
                         └───┬──────────┬─────────┘
                             │          │
                  ┌──────────▼───┐  ┌───▼────────────┐
                  │ Context      │  │ Governance     │
                  │ materialize  │  │ permission     │
                  │ compile      │  │ approval       │
                  └──────┬───────┘  └──────┬─────────┘
                         │                 │
                  ┌──────▼─────────────────▼──────┐
                  │ Session Item Log / TurnEvent   │
                  │ facts / derived observation     │
                  └──────────────┬──────────────────┘
                                 │
                  ┌──────────────▼──────────────────┐
                  │ Provider / Runtime Integration   │
                  │ local · HTTPS · future remote    │
                  └─────────────────────────────────┘
```

MoonTide 的能力模型分为九类：

1. Context Acquisition；
2. Agent Loop Execution；
3. Workspace Change and Verification；
4. Permission and Governance；
5. Session Continuity and Recovery；
6. Task Decomposition；
7. Extensibility and Integration；
8. Provider and Runtime Portability；
9. Observability and Evaluation。

## 4. Capability 1 — Context Acquisition

### 目标

让 Agent 能够获得完成当前任务所需的项目上下文，并控制上下文的来源、规模和语义。

### 能力组成

- 读取文件和目录；
- 搜索文件名和内容；
- 获取 Git 状态与变更；
- 加载项目级指令文件；
- 将 Session Item Log materialize 为 model-visible messages；
- 将 SystemPrompt、messages 和 tools compile 为 ModelRequest；
- 未来按需求支持 compaction、summary、retrieval 或 artifact context。

### 所有权与边界

- `agent-tools` 拥有第一方工具实现；
- `agent-core::context` 拥有 Session Item Log → messages 的 `materialize`；
- `agent-core::model_input` 拥有 messages + tools + system prompt → ModelRequest 的 `compile`；
- CLI/Desktop 只表达 intent 或显示 derived state，不拥有业务上下文；
- Context 不写回 Session Item Log，不决定 permission，不拥有 provider wire format。

### 当前判断

小型组合式工具优先：`read`、`grep`、`find`、`ls`、`bash`。只有当实际任务证明基础工具不足时，才引入统一资源工具、语义索引或更重的检索设施。

### 验收方向

- 同一 Session Item Log 在不同宿主中 materialize 结果一致；
- dangling tool call/result 被拒绝，不进入 ModelRequest；
- compile 不改变 provider-neutral message 语义；
- 大文件和大工具输出的处理策略可解释、可测试。

## 5. Capability 2 — Agent Loop Execution

### 目标

让 Agent 能以明确的 Session → Turn → Step → Tool round 层级持续推进任务。

### 能力组成

- 接受一个 UserMessage 并创建 Turn；
- 编译 ModelRequest；
- 调用 LLMProvider 并处理 streaming；
- 识别 assistant response 和 tool calls；
- 运行一个或多个 tool round；
- 将 ToolResult 返回下一 Step；
- 支持 retry、cancellation、step limit 和 terminal response；
- 在错误或取消后保持可继续的事实状态。

### 所有权与边界

- `agent-core::loop` 独占 AgentLoop 和 SessionStore；
- `agent-core::llm` 拥有 provider-neutral protocol、adapter 和 normalize；
- `agent-core::tools` 拥有 ToolSpec、validation、executor contract；
- `agent-core::event` 拥有 TurnEvent dispatch 和 derive；
- `agent` 负责 provider、tools、permission 和 event 的组合；
- `cli` 和 Desktop 不复制 loop，不直接推进 Step。

### 不变量

- 一个 LLM retry 不创建新的 Step；
- 一个 Tool Call 必须最终拥有且仅拥有一个 ToolResult；
- executor 基础设施错误先记录 `OutcomeUnknown`，再把原始错误传播到 Turn 边界；
- cancellation 必须清理当前 call 和 sibling calls 的状态；
- 成功流以明确的 MessageEnd/terminal response 结束。

### 验收方向

- 能用 Recording Provider 验证多 Step ModelRequest；
- 能用 Tool round 测试验证 call/result 闭合；
- 错误、取消、retry 和 step exhaustion 都有明确 Session facts 和返回错误；
- CLI 与 Desktop 对同一 TurnEvent 序列得到一致业务状态。

## 6. Capability 3 — Workspace Change and Verification

### 目标

让 Agent 不只是生成建议，而是能够安全地对工作区执行变更并验证结果。

### 能力组成

- 文件读取；
- 文件编辑和创建；
- patch 应用；
- Shell 命令；
- 测试、构建、格式化和 lint；
- Git diff 和状态检查；
- 变更摘要；
- 未来的 workspace snapshot、revert 和 change artifact。

### 所有权与边界

- Tool executor 负责实际 IO；
- Permission/approval 决定是否允许执行；
- Workspace change 事实通过 Session Item Log 和 TurnEvent 记录；
- UI 显示 diff 和执行状态，但不拥有文件变更事实；
- Workspace rollback 与 Session rollback 是两个不同问题，不能默认合并。

### 当前判断

当前优先保证工具执行、错误传播、变更显示和测试验证。完整 snapshot/revert 作为成熟能力候选，需先明确它是 Git checkpoint、文件快照还是 Runtime change artifact。

## 7. Capability 4 — Permission and Governance

### 目标

让 Agent 的自主性受明确、可观察、可审计的规则约束。

### 能力组成

- tool-level Allow、Ask、Deny；
- approval request 和 decision；
- workspace/file boundary；
- network boundary；
- 命令执行策略；
- 用户交互式与非交互式模式；
- future repo policy、role policy 和 sandbox policy。

### 所有权与边界

- `agent` 组合根声明当前权限映射；
- `loop` 在 Tool Call 执行前查询 permission；
- `agent-tools` 不定义全局 permission policy；
- CLI/Desktop 负责展示 approval 和采集用户 intent；
- Hook 不得静默改变 loop 的 Allow、Ask、Deny、Cancel、Retry 或完成决策；
- OS sandbox 属于执行环境边界，不等价于业务 permission。

### 当前判断

Permission 必须先于更复杂的 extension、subagent、remote runtime 建立稳定契约。任何新执行路径都必须回答：它使用哪套 permission、是否继承 sandbox、如何记录 decision。

### 验收方向

- 缺失 permission 安全拒绝；
- Ask 没有 handler 时启动阶段失败，而不是运行中静默放行；
- approval decision 与 tool call、turn、session 可关联；
- permission error 不留下已记录但无结果的 ToolCall。

## 8. Capability 5 — Session Continuity and Recovery

### 目标

让用户可以继续、检查和恢复 Agent 工作，而不依赖当前进程或 UI 内存。

### 能力组成

- Session create/load；
- date-partitioned persistence；
- Session Item Log append；
- Session history query；
- resume；
- fork；
- turn failure continuation；
- future compaction、branch summary、revert 和 recovery checkpoint。

### 所有权与边界

- Session Item Log 是可恢复事实源；
- `session` 是唯一写者；
- `context` 只 materialize，不反向修改 session；
- Agent Event Log 是 derive 的观测记录，不覆盖 Session Item Log；
- UI 只显示 Session state，不拥有 Session state。

### 当前判断

Session Continuity 是当前基础能力，不应被视为“以后再做的便利功能”。Compaction、memory、retrieval 和跨设备同步则是后续 capability，不能混入当前 Session persistence 契约。

### 验收方向

- 进程退出后可以从 Session Item Log 恢复；
- 失败 Turn 的 facts 不被静默删除；
- materialize 结果可重放；
- fork 不修改原 Session 的既有事实。

## 9. Capability 6 — Task Decomposition

### 目标

让复杂任务可以被拆分、追踪和验证，但不提前引入没有需求的多 Agent 调度。

### 能力组成

- 当前 Turn 内的 Step 和 Tool round；
- 可观察的 task progress；
- 后续 todo/plan；
- 后续 subagent delegation；
- 后续 scheduler、parallelism 和 resource claim；
- 成熟阶段的 role/fleet/agent team。

### 当前判断

当前先把 Turn、Step、Tool round 和 cancellation 做正确。Subagent、Fleet 和 scheduler 只有在以下需求出现后再架构对齐：

- 长时间后台任务；
- 并发 Agent；
- 独立上下文和独立权限；
- 跨任务资源调度；
- 用户需要查看、暂停和恢复子任务。

## 10. Capability 7 — Extensibility and Integration

### 目标

允许 MoonTide 在不破坏核心边界的情况下增加能力。

### 扩展类型

| 类型 | 负责的问题 | 当前判断 |
|------|------------|----------|
| Tool | 模型可调用的结构化动作 | 当前核心能力 |
| Skill | 可按需加载的知识或工作流 | 后续按需求 |
| Command | 用户直接触发的 prompt/workflow | CLI/UI 层候选 |
| Hook | 已提交事实后的观察或自动化副作用 | 当前仅 post-commit、fail-open |
| MCP | 外部系统和工具连接 | 后置，需证明外部集成需求 |
| Plugin | 扩展资源的打包和分发 | 成熟产品候选 |
| SDK/RPC | 被其他宿主调用 | Desktop/嵌入需求驱动 |

### 边界规则

不建立万能扩展接口。不同扩展类型必须有不同的生命周期、权限、失败和上下文语义。

## 11. Capability 8 — Provider and Runtime Portability

### 目标

让 Agent Loop 不依赖某个具体模型供应商、HTTP wire protocol 或模型运行位置。

### 能力组成

- provider-neutral LLM protocol；
- ProviderProfile；
- ModelProfile；
- model endpoint；
- streaming、tool calling、reasoning 和 response normalization；
- local process、direct HTTPS、SSH tunnel、managed GPU 和 future remote worker；
- context/output limits 和 model capability metadata。

### 所有权与边界

- `agent-core::llm` 负责 provider-neutral protocol、adapter 和 normalize；
- `agent` 组合 Provider、Model、endpoint 和 preset；
- Remote Runtime（未来）负责 SSH、GPU、模型服务生命周期和 health check；
- Remote Runtime 不拥有 Session Item Log、Tool permission 或 AgentLoop；
- credentials 不进入 Session Item Log、Agent Event Log 或 model prompt。

### 当前判断

Provider-neutral LLM 是当前核心边界；SSH、GPU lease、远程 Worker 和模型部署属于成熟产品方向，不是当前 Desktop Shell v0.1 的实现承诺。

## 12. Capability 9 — Observability and Evaluation

### 目标

让用户和开发者能够理解 Agent 做了什么、为什么失败，以及一个能力是否真的改善了结果。

### 能力组成

- assistant streaming snapshot；
- Turn/Step/Thinking/ToolCall/ToolResult 状态；
- approval/error/cancellation/completed 状态；
- Session Item Log replay；
- Agent Event derive；
- diagnostic logs；
- provider request recorder；
- focused tests、workspace gates 和 task-level evals；
- future cost/token and performance evidence。

### 边界

- Session Item Log 记录产品事实；
- Agent Event Log 记录由 TurnEvent derive 的观测；
- developer diagnostics 与用户 transcript 分离；
- 默认不记录完整 prompt、tool output、secret 或敏感文件内容；
- eval artifact 记录验证证据，不成为运行时事实源。

### 当前判断

先保证事件、Session 和 provider recorder 能够解释一个 Turn，再讨论 OTel、全量 prompt tracing 或复杂 telemetry。

## 13. 阶段视图

| 能力 | 当前 Rust/CLI 基础 | Desktop Shell v0.1 | 成熟产品方向 | 暂不承诺 |
|------|--------------------|--------------------|--------------|----------|
| Context | materialize、compile、基础工具 | 状态展示和输入 | compaction、retrieval、memory | 通用资源平台 |
| Agent Loop | Turn、Step、Tool round、retry、cancel | 复用同一 Runtime | scheduler、长任务 | 多 Agent 并发 |
| Workspace | read/edit/bash/test、diff | 变更摘要和打开文件 | snapshot、artifact、rollback | 自动 workspace sync |
| Permission | tool map、approval seam | approval UI | sandbox、repo policy、role policy | 隐式自动放行 |
| Session | Session Item Log、load/fork | create/resume/history | branch summary、cross-device | 数据库迁移层 |
| Extensibility | Tool catalog、post-commit Hook | 宿主事件接入 | Skill、MCP、Plugin、SDK | 万能 Plugin API |
| Provider | provider-neutral LLM、adapter/normalize | provider/model settings | remote endpoint、GPU runtime | 直接复制竞品远程架构 |
| Decomposition | Step/tool round | 单活跃 Session | subagent、scheduler、fleet | 没有需求的多 Agent |
| Observability | TurnEvent、derive、recorder | RenderState 和 UI events | eval、cost、performance evidence | 默认全量敏感日志 |

## 14. 从能力到功能的推导示例

### 示例：Session Continuity

```text
用户目标：任务中断后可以继续
  ↓
能力：Session Continuity
  ↓
行为：事实追加、历史加载、恢复、分叉
  ↓
功能：/resume、session list、fork、history UI
  ↓
实现：Session Item Log、SessionStore、materialize
  ↓
验收：进程重启后恢复相同事实和上下文
```

### 示例：Permission and Governance

```text
用户目标：Agent 自动化但不越过安全边界
  ↓
能力：Permission and Governance
  ↓
行为：Allow、Ask、Deny、approval、sandbox
  ↓
功能：approval prompt、permission settings、sandbox profile
  ↓
实现：组合根 permission map、loop check、executor boundary
  ↓
验收：危险操作不会绕过 policy，错误不会留下悬空 ToolCall
```

## 15. 能力决策规则

新能力进入 MoonTide 之前，必须回答：

1. 它解决哪个用户问题？
2. 这个问题在当前产品阶段是否真实存在？
3. 它属于哪个 capability？
4. 谁拥有状态、生命周期和失败语义？
5. 它是否改变 Session、Tool、Permission、Event、Provider 或 UI 边界？
6. 是否有最小纵向闭环可以验证？
7. 是否有 focused test、task eval 或真实使用证据？
8. 如果不做它，当前用户任务是否真的受阻？

决策结果只能是：

```text
Adopt      采用
Adapt      借鉴后按 MoonTide 边界改造
Defer      能力成立，但延后
Reject     不符合产品目标或复杂度不值得
Investigate 证据不足，需要实验
```

## 16. 相关文档

- [`README.md`](README.md)
- [`plan.md`](plan.md)
- [`mature-product-direction.md`](mature-product-direction.md)
- [`desktop-development-direction.md`](desktop-development-direction.md)
- [`../../crates/docs/agent-core.md`](../../crates/docs/agent-core.md)
- [`competitor-solution-matrix.md`](competitor-solution-matrix.md)
