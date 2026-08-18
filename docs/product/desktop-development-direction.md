# MoonTide Desktop Shell 开发方向

> **状态：** 已确认，作为下一阶段开发基线
> **范围：** Desktop Shell、`agent` 宿主接缝和 `agent-core` 稳定边界
> **不属于本文：** Slint 视觉稿、具体 UI 组件实现、scheduler 设计、产品商业化

## 1. 结论

`agent-core` 的主干已经基本完成，可以从“内核模块建设”切换到“Desktop 宿主能力建设”。

这里的“基本完成”有明确边界：

- `llm`、`session`、`tools`、`event`、`model_input`、`context`、`loop` 已完成当前 R1 分期的设计、实现和测试；
- `scheduler` 暂缓，因为当前单 AgentLoop、顺序 Tool round 和单 Session writer 尚未产生真实调度需求；
- `agent` 已经是组合根，Desktop 应复用 `Agent::create/resume/turn`，不复制 AgentLoop；
- Desktop 仍缺少流式 assistant 文本、Session 查询体验、UI 事件通道和桌面生命周期接缝。

因此，下一阶段不是继续扩大 `agent-core`，而是完成一个可恢复、可观察、可取消的 Desktop Agent Host。

本方向已确认的 v0.1 范围：单窗口、单活跃 Session、Turn 串行；Desktop 直接复用 `agent`，暂不引入多 Session 并发、scheduler 或多 Agent。

## 2. 当前架构基线

```text
Slint Desktop Shell
        │
        │ Agent API + UI event observer + approval + cancellation
        ▼
agent（组合根）
        │
        ├── agent-core（Turn / Session / Tool / Event / Context）
        └── agent-tools（第一方工具 catalog）
```

### 已有能力

`agent` 已提供：

- `Agent::create` / `Agent::resume` / `Agent::turn`；
- Session Item Log 创建和恢复；
- provider、工具 catalog、permission、approval 的装配；
- `CancellationToken` 取消入口；
- Turn、LLM、ToolCall、ToolResult、Thinking 等进度事件；
- Agent Event JSONL 观测记录。

### 当前缺口

- `Agent::turn()` 只返回最终 `ModelResponse`；
- `ProgressEvent` 尚未暴露 assistant 文本 `ModelResponseSnapshot`；
- Desktop 没有 Session 列表、历史查询、切换和分支的宿主 API；
- 没有明确的 Desktop 关闭、取消、等待清理和恢复流程；
- 没有 Desktop 专用的配置持久化和密钥保护；
- CLI 文档和 TASKS 状态仍有历史漂移，需要在实现前同步。

## 3. Desktop v0.1 范围

推荐第一版采用：

- 单窗口；
- 一个活跃 Session；
- 一个活跃 Turn；
- 同一 Session 内串行执行；
- 本地 Rust + Slint，同进程调用 `agent`；
- UI 通过宿主事件接缝观察运行状态，不直接访问 `agent-core` 内部状态。

这不是能力上的永久限制，而是与当前 `AgentLoop` 的 ownership 和 Session writer 约束一致的第一版产品边界。

## 4. 功能清单

### P0：Desktop 开发前置能力

| 能力 | 用户结果 | 主要 owner | 验收标准 |
|---|---|---|---|
| Assistant 流式渲染 | 回复逐步出现，不显示“假死” | `agent` + Desktop | 文本 snapshot 持续更新，最终内容与 `ModelResponse` 一致 |
| UI 事件通道 | 显示当前 Turn、Step、Thinking、Tool 状态 | `agent` 宿主接缝 | 事件不阻塞 Loop；snapshot 可合并，完成/错误/审批事件不丢 |
| 工具审批 | 用户明确允许或拒绝写入、编辑、bash | Desktop approval handler | 默认安全拒绝；显示工具名、参数摘要、工作目录 |
| 取消与清理 | 用户可以中断当前 Turn | Desktop + `CancellationToken` | `cancel → await cleanup`；ToolCall 与 ToolResult 仍保持配对 |
| 运行状态 | 用户知道 Agent 是 idle、thinking、tool、waiting approval 还是 error | Desktop state model | 状态不会因普通 provider/tool 错误卡死 |
| Session 恢复 | 重启后继续已有 Session | `agent` + Session query | 能选择 Session，加载历史并执行下一 Turn |
| 错误展示 | 用户能区分配置、模型、工具、取消和未知结果 | Desktop renderer | 错误可见、可复制，REPL/Session 不被错误永久阻塞 |
| 配置与密钥 | 用户能设置工作目录、模型、Endpoint、API key | Desktop settings | Agent 只接收显式配置；密钥不写入 Session 或 Agent Event |
| 优雅关闭 | 关闭窗口不会遗留未清理执行 | Desktop lifecycle | 运行中关闭先取消并等待，再释放 Agent |

### P1：Coding 工作台能力

- Session 列表、最近打开、切换和基础元信息；
- Session fork / branch，用于在某个事实边界上分支尝试；
- 工具调用详情、参数、结果和折叠展示；
- 文件变更摘要、diff、打开文件和复制结果；
- 重新执行上一 Turn 的显式操作；
- 工作目录切换和项目 `AGENTS.md` 状态展示；
- Thinking 展示开关、trace 级别和诊断日志入口；
- 多行输入、输入历史和发送中禁用重复提交。

### P2：后续平台能力

- 多 Session 并发；
- 后台 Turn、队列和任务通知；
- 跨进程模型 daemon；
- sidecar / MCP 扩展；
- 多 Agent、delegate 和 scheduler；
- 跨设备同步、远程 RPC、自动更新和完整崩溃恢复。

P2 不应提前进入 Desktop v0.1。它们会引入跨进程 ownership、锁、队列、公平性、协议版本和资源调度问题。

## 5. 流式 UI 的契约要求

流式 UI 不应直接消费 provider 的 `ModelStreamEvent`，也不应让 Desktop 自己 fold provider 增量。推荐沿用现有链路：

```text
LLM SSE
  → ModelResponseBuilder
  → ModelResponseSnapshot
  → TurnEvent::MessageUpdate
  → agent::ProgressEvent
  → Desktop UI
```

要求：

1. 新增面向宿主的 assistant snapshot 事件，至少包含 `turn`、`step` 和稳定更新顺序；
2. UI 按 snapshot 替换当前草稿，不盲目追加 delta，避免 retry 或重复事件造成文本重复；
3. snapshot 是临时 UI 状态，不写入 Session Item Log；
4. 最终 `Agent::turn()` 仍返回完整 `ModelResponse`，保持 CLI 和其他宿主兼容；
5. 事件通道使用有界、非阻塞的宿主适配；旧 snapshot 可以合并，审批、错误、取消和完成事件不能静默丢失；
6. Thinking 默认隐藏或折叠，不能与 assistant final text 混为同一内容。

## 6. 模块 owner

| 能力 | 归属 | 不应归属 |
|---|---|---|
| Turn / Step / Tool round 顺序 | `agent-core::loop` | Desktop |
| Session 事实写入 | `agent-core::session` / Loop commit seam | Desktop |
| Provider 流式 fold | `agent-core::llm` | Desktop |
| Host-facing progress / snapshot | `agent` | `agent-core` 直接依赖 Slint |
| approval UI | Desktop | Hook / event derive |
| Session 列表和只读历史查询 | `agent` 宿主 API | Desktop 直接解析内部 JSONL |
| UI 状态、窗口生命周期、渲染 | Desktop | `agent-core` |
| 多 Agent、队列、资源调度 | 后置 scheduler / 组合层 | v0.1 Desktop |

## 7. Desktop v0.1 验收路径

```text
启动 Desktop
  → 选择或创建工作目录
  → 创建 Session
  → 输入用户目标
  → assistant 文本流式出现
  → 需要工具时弹出 approval
  → 展示 ToolCall / ToolResult
  → 展示最终回复
  → 取消一次运行并确认清理
  → 关闭并重新打开
  → 恢复同一 Session
  → 执行下一 Turn
```

必须同时验证：

- 无 API key、无效配置和 provider 错误的显示；
- 工具拒绝、工具预期失败和 `OutcomeUnknown` 的区别；
- 取消期间 Session Item Log 仍可 materialize；
- Desktop 关闭后不会留下无法恢复的半轮状态；
- stdout、UI 事件、Session Item Log 和 Agent Event Log 不互相越界。

## 8. `agent-core` 完成度判断

### 可以视为完成的部分

- 当前核心模块的设计、实现、单元测试和边界测试已形成闭环；
- Session 是事实源，Loop 独占 SessionStore，Tool round、permission、retry、cancellation 语义已经明确；
- `agent` 已把核心装配成可被 CLI 和 Desktop 复用的宿主 API。

### 不能称为最终完成的部分

- 流式 UI 所需的宿主事件契约尚未落地；
- event bus、OTel、compaction、memory、retrieval、scheduler 等仍是后置能力；
- Desktop 需要的 Session query、恢复和生命周期语义尚未形成完整 API；
- 尚未完成真实 provider 的 Desktop 端到端 smoke test 和打包验收。

因此，准确表述是：

> `agent-core` 主干已基本完成，进入稳定底座与按真实消费者补能力阶段；当前主开发方向切换为 Desktop Shell，不再以继续扩张 Core 模块为目标。

## 9. 建议开发顺序

1. 对齐并落地 `AssistantSnapshot` 与宿主 UI 事件契约；
2. 建立 Desktop crate 的单窗口、单活跃 Session 外壳；
3. 接入 approval、CancellationToken、错误和优雅关闭；
4. 补 Session 列表、历史查询和恢复 smoke test；
5. 完成真实 provider 的流式端到端验证；
6. 再做 diff、Session fork、工作目录切换等 P1 功能；
7. 只有出现真实并发/队列需求时，重新启动 scheduler 架构对齐。

本文件是已确认的产品方向基线；实现前仍需为 Desktop 模块补齐 README、DESIGN 和分批 TASK，不直接把整份清单一次性实现。
