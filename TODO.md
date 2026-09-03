# MoonTide 当前执行路线

> **性质：** 当前执行优先级，不覆盖 `AGENTS.md`、工程手册或当前 Rust 系统契约。
> **当前阶段：** Desktop Shell v0.1
> **产品方向：** [`docs/product/desktop-development-direction.md`](docs/product/desktop-development-direction.md)
> **工程进度：** [`.agents/skills/moontide-kernel-plan/PROGRESS.md`](.agents/skills/moontide-kernel-plan/PROGRESS.md)
> **历史路线：** [`docs/archive/notes/runtime/todo-legacy-2026-08.md`](docs/archive/notes/runtime/todo-legacy-2026-08.md)
> **候选工程路线：** [`docs/notes/roadmap/README.md`](docs/notes/roadmap/README.md)
> **候选产品方向：** [`docs/product/future-directions.md`](docs/product/future-directions.md)

## 状态约定

| 状态 | 含义 |
|---|---|
| `✅` | 代码、测试和当前文档三项证据一致 |
| `◐` | 已有实现和测试，但仍有 Review、集成或端到端门禁 |
| `☐` | 尚未开始，或明确后置 |

## 1. 当前基线

### 1.1 Rust Agent Core

| 模块 | 状态 | 当前边界 |
|---|---|---|
| `llm` | ✅ | Provider-neutral protocol、SSE stream、adapter/normalize、retry 接缝 |
| `session` | ✅ | Session Item Log、create/load/fork、typed ToolCall/ToolResult |
| `tools` | ✅ | ToolSpec、冻结 Registry、schema validation、单次调用规范化 |
| `event` | ✅ | TurnEvent、commit seam、derive、post-commit fail-open Hook；bus 后置 |
| `model_input` | ✅ | `compile()` 作为 ModelRequest 唯一运行时构造出口 |
| `context` | ✅ | `materialize()`、tool round 配对校验；compaction 后置 |
| `loop` | ✅ | Session → Turn → Step → Tool round、permission、retry、cancel、cleanup |
| `scheduler` | ☐ | 只有出现并发、资源冲突、共享 daemon 队列或多 Agent 公平性时再设计 |

### 1.2 宿主基线

- `agent` 已提供 `Agent::create/resume/turn` 和组合根装配。
- CLI 已具备 one-shot、Harness Console、approval、Settings、Ctrl-C、直播 Progress 和 trace 接缝。
- Session Item Log 是恢复事实源；Agent Event Log 只用于观测。
- Desktop 不通过 CLI 子进程接入，直接复用 `agent`。

## 2. Desktop Shell v0.1 P0

范围固定为：单窗口、单活跃 Session、Turn 串行。

- [ ] **Assistant 流式 snapshot**：逐步显示 assistant 文本，最终内容与完整 `ModelResponse` 一致。
- [ ] **宿主 UI 事件通道**：展示 Turn、Step、Thinking、ToolCall、ToolResult、approval、错误和完成状态。
- [ ] **工具审批 UI**：默认安全拒绝，展示工具名、参数摘要、工作目录和风险提示。
- [ ] **取消与清理**：`cancel → await cleanup`，保持 ToolCall/ToolResult 配对。
- [ ] **运行状态模型**：`idle / thinking / tool / waiting approval / cancelling / error / completed`。
- [ ] **Session 恢复**：启动、选择、加载历史并执行下一 Turn。
- [ ] **错误展示**：区分配置、provider、工具预期失败、OutcomeUnknown、取消和基础设施错误。
- [ ] **配置与密钥**：工作目录、Endpoint、模型、API key 和 approval policy；密钥不写入 Session 或 Agent Event。
- [ ] **优雅关闭**：窗口关闭时取消运行、等待清理、再释放 Agent。

## 3. Desktop P1 Coding 工作台

- [ ] Session 列表、最近打开、切换和基础元信息。
- [ ] Session fork / branch，在合法 turn 边界创建分支。
- [ ] ToolCall/ToolResult 详情、参数、结果和折叠展示。
- [ ] 文件变更摘要、diff、打开文件和复制结果。
- [ ] 显式重新执行上一 Turn。
- [ ] 工作目录切换和项目 `AGENTS.md` 状态展示。
- [ ] Thinking 展示开关、trace 级别和诊断入口。
- [ ] 多行输入、输入历史和发送中禁用重复提交。

## 4. Agent Core 稳定维护项

- [ ] 为 Desktop 补齐 `AssistantSnapshot` 和宿主 UI 事件契约；不让 Desktop 自己消费或 fold provider stream。
- [ ] 补齐 Session 只读查询、历史 materialize 和恢复所需的 `agent` 宿主 API。
- [ ] 为取消、进程关闭、异常中断和下一 Turn 恢复补充集成测试。
- [ ] 完成真实 provider 的 Desktop 流式端到端 smoke test。
- [ ] 保持 Session Item Log、Agent Event Log、UI 事件和 stdout 边界分离。
- [ ] 只有发生真实消费者时，才重新设计 event bus、compaction、memory、retrieval 或 scheduler。

## 5. 后置能力与触发条件

| 能力 | 触发条件 |
|---|---|
| 多 Session 并发 | Desktop 需要同时运行多个 Session，且已定义 writer/lease 语义 |
| 后台队列 | Turn 需要脱离当前窗口持续运行，且已有任务通知模型 |
| scheduler | 出现并发 ToolCall、资源冲突、共享模型 daemon 队列、tool retry 或 offload/failover |
| 多 Agent / delegate | 明确主从任务、配额、嵌套和恢复语义 |
| sidecar / MCP | 出现真实跨进程扩展消费者和协议版本需求 |
| 本地模型 daemon | 内核宿主契约稳定，且本地常驻推理有真实性能需求 |
| compaction / memory / retrieval | 真实 Session 规模和上下文压力证明 R1 materialize 不足 |
| Go services / Node extension | Rust 单进程无法承担真实后台或生态边界 |

## 6. 文档维护门禁

- [x] 活动文档只引用当前 Rust 路径，不把 TypeScript 作为当前实现。
- [x] 每个当前系统或模块文档明确性质、状态、关联文档和非目标。
- [x] `README.md`、`docs/README.md`、`AGENTS.md`、`crates/docs/` 和 `PROGRESS.md` 的当前阶段描述一致。
- [x] 活动文档本地链接可解析；`docs/archive/` 的历史失效链接不纳入当前门禁。
- [x] 文档-only 变更运行链接审计、`git diff --check`；涉及代码示例或契约时补跑对应测试。

## 7. 历史路线

原 TODO 文件已完整归档至 [`docs/archive/notes/runtime/todo-legacy-2026-08.md`](docs/archive/notes/runtime/todo-legacy-2026-08.md)。历史 TypeScript 设计、旧评测计划和旧产品 backlog 不参与当前执行优先级。
