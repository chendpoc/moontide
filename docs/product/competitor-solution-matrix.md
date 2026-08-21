# Agent CLI 竞品解决方案矩阵

> **性质：** Research baseline
> **状态：** Snapshot collected on 2026-08-20；不构成 MoonTide 的实现承诺
> **目的：** 记录典型 agent CLI 如何解决共同问题，为 MoonTide 能力模型提供外部证据

本文研究 Pi、Codex CLI、Claude Code CLI、CodeWhale 和 OpenCode。本文关注的是：

```text
用户问题 → 产品能力 → 调用机制 → 权限/持久化/恢复语义 → 产品取舍
```

本文不把竞品命令名、目录结构或内部 API 视为 MoonTide 的设计蓝图。功能是否仍然存在、是否需要账号或特定版本，必须以对应项目当前文档和源码为准。

## 1. 共同问题与共同执行模型

这几个产品普遍解决同一个问题：用户用自然语言描述代码任务，agent 在本地或受控运行时中获取上下文、修改工作区、执行验证，并在过程中保持可控和可恢复。

共同的调用模型可以抽象为：

```text
用户输入 / CLI 命令
        ↓
会话状态 + 项目上下文 + 权限策略
        ↓
模型请求
        ↓
结构化 tool call
        ↓
权限检查 / 沙箱检查 / 用户审批
        ↓
工具执行：read / search / edit / bash / test / external service
        ↓
ToolResult / lifecycle event
        ↓
追加回当前上下文，模型继续下一轮
        ↓
完成、失败、取消或等待用户
```

差异主要出现在执行循环外层：

| 维度 | 需要观察的问题 |
|------|----------------|
| 工具 | 工具是否小而组合化，还是提供更完整的 coding catalog |
| 治理 | allow、ask、deny、sandbox、network 和 repo policy 如何组合 |
| 会话 | 如何保存、恢复、分叉、压缩、撤销和重放 |
| 编排 | 是否有 plan、todo、subagent、fleet 或 agent team |
| 扩展 | Skill、Command、Hook、MCP、Plugin 是否区分职责 |
| Provider | 是否绑定模型供应商，还是支持多 Provider、多 Model 和自定义 endpoint |
| 宿主 | 是否同时支持 TUI、headless、SDK、RPC、HTTP server 或远程运行 |

## 2. 竞品摘要

| 产品 | 主要解决的问题 | 核心能力形态 | 主要调用入口 | 主要产品取舍 |
|------|----------------|--------------|--------------|--------------|
| Pi | 在终端完成可恢复、可扩展的 coding agent 工作 | 小型内置工具 + Session tree + TypeScript extensions | TUI、print、JSON/RPC、SDK | 核心最小化，能力交给扩展 |
| Codex CLI | 在本地仓库中受治理地 inspect、edit、run，并支持自动化 | 工具调用 + approval + sandbox + thread protocol | TUI、`exec`、app-server、SDK | 执行边界和外部客户端协议优先 |
| Claude Code | 用自然语言完成完整 coding workflow，并连接外部系统 | 内置工具 + Context/Memory + Skill/MCP/Hook/Subagent | TUI、print/JSON、远程 session、SDK | 工作流和扩展生态优先 |
| CodeWhale | 多 Provider、多角色的本地 coding harness | Role + Model routing + Mode + Constitution + Ledger | TUI、`exec`、本地 Web、Fleet | 模型与角色显式解耦，治理层较丰富 |
| OpenCode | Provider-neutral、可配置、可服务化的 coding runtime | Tool catalog + per-tool permission + Agent/Command + snapshot | TUI、`run`、HTTP server | 开放配置、服务化和外部模型优先 |

## 3. Pi

### 3.1 解决的问题

Pi 的定位是 minimal terminal coding harness：保持核心较小，让用户通过 TypeScript extensions、skills、prompt templates、themes 和 packages 扩展行为。

它主要解决：

- 在终端探索、修改和验证代码；
- 保存并恢复 coding session；
- 从历史路径分叉，比较不同解决方向；
- 在交互式 TUI 之外被脚本、SDK 或其他 UI 嵌入；
- 用用户自己的扩展增加工具和生命周期行为。

### 3.2 能力与调用机制

| 能力 | 观察到的机制 |
|------|--------------|
| 基础 coding tools | 内置 `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`；通过 tool allowlist 或 exclude 控制可见工具 |
| Session continuity | Session 按工作目录保存为 JSONL tree；支持 continue、resume、fork、clone、tree navigation |
| Context management | Context 超出阈值时 compaction；切换分支时可生成 branch summary；不在 tool result 中间截断 |
| Extension | Extension 可注册 custom tool、command、lifecycle event、UI，并可持久化 extension entry |
| Headless/embedding | print、JSON event stream、stdin/stdout RPC 和 Node.js SDK |
| Model/tool selection | CLI、SDK 和 resource loader 选择 provider、model、thinking level、内置工具和扩展工具 |

Pi 的核心调用链可以表示为：

```text
AgentSession
  → Agent
  → provider/model request
  → structured tool call
  → builtin/custom tool
  → tool result appended to session
  → next agent turn
```

Pi 的扩展层还可以订阅生命周期事件、注册命令、注册工具和影响工具调用。因此它是一个可编程 harness，而不仅是固定功能的 CLI。

### 3.3 关键取舍

- 保留小型、通用、可组合的内置工具集；
- 把高级行为放在 extension/package 层；
- 把 session tree 作为恢复和分支探索的基础；
- 通过 RPC/SDK 让同一 Agent 能力被其他宿主复用；
- 允许扩展介入更多生命周期，但这也扩大了扩展对核心决策的影响范围。

### 3.4 对 MoonTide 的观察

可借鉴：小工具组合、Session 分支、RPC/SDK、显式 compaction 边界。

不能直接照搬：Pi 的扩展可阻止或修改工具调用；MoonTide 当前的 Hook 设计是 post-commit、fail-open，permission、cancel、retry 和 scheduler 必须走显式 API。

## 4. Codex CLI

### 4.1 解决的问题

Codex CLI 重点解决：

- 在本地仓库中理解代码、修改文件和运行命令；
- 对长任务提供可调节的自动化程度；
- 将文件系统、网络和命令执行置于明确的 sandbox/approval 边界内；
- 支持 code review、脚本、CI、Skills、Plugins、MCP 和子 Agent；
- 让 CLI、Desktop、SDK 或其他客户端共享 thread/turn/item 运行协议。

### 4.2 能力与调用机制

| 能力 | 观察到的机制 |
|------|--------------|
| Coding loop | 模型读取文件、提出修改、执行命令、查看结果并继续下一轮 |
| Approval | 根据 approval policy 对文件修改、命令和网络请求发起审批；支持会话级或持久化选择 |
| Sandbox | workspace、read-only、full access 等文件系统/网络边界；可按 thread 或 turn 配置 |
| Session | `thread/start`、`thread/resume`、`thread/fork`、archive 和 item/turn 事件 |
| Automation | `codex exec` 适合非交互式流程；SDK 和 app-server 提供结构化调用 |
| Extension | Skills、Plugins、MCP 和 subagents 扩展主循环 |
| Review | 在本地工作区检查变更，并将任务结果留在当前 terminal workflow 中 |

Codex 的执行调用链是：

```text
Model tool call
  → approval policy
  → sandbox policy
  → user / automatic approval decision
  → local executor
  → item events
  → tool result / transcript
  → model continues
```

app-server 将操作结构化为 thread、turn、item 和 approval 请求。例如客户端可以启动或恢复 thread，开始 turn，并处理 command execution approval。

### 4.3 关键取舍

- Agent 可以自主执行，但执行边界必须显式、可见、可审计；
- Permission 与 sandbox 不是 TUI 的视觉状态，而是 Runtime 的执行条件；
- Thread/Turn/Item 事件让 Desktop、SDK 和 CLI 可以复用相同状态；
- 自动化入口和交互式入口共用 Agent 能力，但呈现方式不同。

### 4.4 对 MoonTide 的观察

可借鉴：Tool Call 与 Approval 的关联、Session/Turn/Step 的分层、sandbox 作为执行边界、未来 Desktop 共享 Runtime 状态。

暂不直接引入：完整 app-server、云端 handoff、subagent orchestration；这些需要长任务、并发、恢复或多宿主需求作为前置证据。

## 5. Claude Code CLI

### 5.1 解决的问题

Claude Code 以 coding workflow 为中心，主要解决：

- 通过自然语言完成代码库探索、修改和验证；
- 让项目规则在每次会话中持续生效；
- 通过自动上下文管理和 memory 减少重复说明；
- 通过 Skills、MCP、Hooks、Subagents 和 Plugins 扩展工作流；
- 将本地 session 与 IDE、远程和团队场景连接起来。

### 5.2 能力与调用机制

| 能力 | 观察到的机制 |
|------|--------------|
| 基础工具 | 文件操作、搜索、Shell/Git/测试、Web、代码智能 |
| Project context | `CLAUDE.md` 在 session start 加载，并按目录层级发现 |
| Memory/context | 自动 memory、context inspection、自动 compaction |
| Permission | default、accept edits、plan、auto 等 permission mode；Tool Call 前可运行 PreToolUse hook |
| Skill | 描述在 session start 可见，完整内容在需要时加载；可由用户或模型调用 |
| MCP | 外部数据库、GitHub、Slack、监控和其他服务作为 MCP tools 接入 |
| Subagent | 独立 context window、独立工具限制和权限，完成后返回摘要 |
| Hook | 在 tool、session、prompt、permission、compaction 等生命周期事件触发 |
| Session | continue、resume、fork、rewind、remote control、print/JSON/stream-json |

Claude Code 的基础调用链是：

```text
Main Agent
  → builtin/custom tool call
  → permission rules / PreToolUse hook
  → executor or MCP server
  → result added to context
  → main Agent continues
```

子 Agent 则是独立的 loop：

```text
Main Agent
  → delegate task
  → isolated Subagent context + tools + permissions
  → subagent loop
  → summary returned to main Agent
```

Claude Code 将 CLAUDE.md、Skill、MCP、Subagent 和 Hook 作为不同的扩展机制，而不是一个万能 Plugin 接口。

### 5.3 关键取舍

- 内置工具覆盖大部分 coding task；
- 常驻规则、按需知识、外部服务、生命周期自动化和隔离子任务分别建模；
- 权限可以由规则和 Hook 共同影响，但 deny/ask 等安全优先级仍由核心权限系统维护；
- 子 Agent 通过隔离上下文降低主会话的 context cost。

### 5.4 对 MoonTide 的观察

可借鉴：Context、Skill、Tool、Hook、Subagent 的职责分化，以及子任务的独立上下文边界。

需要保持差异：MoonTide 的 Hook 不承担 Block、Approve、Cancel、Retry 或改变 loop 决策；这些能力必须由显式 Runtime API 表达。

## 6. CodeWhale

### 6.1 研究对象与不确定性

本文研究的是 GitHub 上的 `davidste/codewhale`。该项目 README 将其描述为 Rust 编写、MIT 许可、支持多 Provider 的 open-source coding agent harness。仓库内容和功能仍可能快速变化，以下结论以 2026-08-20 可见的 README 和相关文档为准。

### 6.2 解决的问题

CodeWhale 重点解决：

- 用户自由选择 Provider、Model 和 reasoning tier；
- 不同角色使用不同模型；
- 在本地以 TUI 或 headless CLI 运行 coding agent；
- 通过 Plan/Act/Operate 和 Ask/Auto-Review/Full Access 控制工作模式；
- 通过 constitution 约束仓库级行为；
- 让多角色任务能够记录、恢复和回滚。

### 6.3 能力与调用机制

| 能力 | 观察到的机制 |
|------|--------------|
| Provider/model routing | Role 显式记录 provider、model 和 reasoning tier；可混用多家模型 |
| Role | Role 文件同时描述模型、工具姿态和长期指令 |
| Workflow mode | Plan、Act、Operate 切换任务行为范围 |
| Permission | Ask、Auto-Review、Full Access；危险命令通过审批路径 |
| Repository law | `constitution.json` 编译成 write holds，形成高于普通 Full Access 的限制 |
| Sandbox | macOS Seatbelt；Linux 可选 bubblewrap |
| Fleet | 多角色顺序执行，各角色可绑定不同模型 |
| Recovery | append-only ledger、fleet resume、workspace snapshot 和 restore |
| Host | TUI、`codewhale exec`、本地 Web client |

CodeWhale 的角色调用链可以表示为：

```text
Fleet / Role
  → provider + model + reasoning tier
  → role instructions + tool posture
  → Agent loop
  → permission / constitution / sandbox
  → tool execution
  → append-only ledger
  → next role or resume
```

### 6.4 关键取舍

- Provider、Model、Role 和 Task 显式解耦；
- 权限不是一个全局开关，而是 Mode、Role、Constitution、Approval 和 Sandbox 的组合；
- 长任务的事实记录不只依赖对话，而有 append-only ledger；
- Fleet 通过角色级模型选择提供多模型协作。

### 6.5 对 MoonTide 的观察

可借鉴：ProviderProfile/ModelProfile 解耦、角色级模型选择、repo-level policy、append-only execution record。

需要谨慎：Fleet、workspace snapshot、constitution 编译和多角色调度会显著扩大生命周期与恢复语义，不能仅因为竞品存在就提前进入 MVP。

## 7. OpenCode CLI

### 7.1 解决的问题

OpenCode 重点解决：

- 在终端完成代码任务；
- 支持多 Provider、OpenAI-compatible endpoint 和多模型配置；
- 允许用户自定义 Agent、Tools、Commands、Skills 和 MCP；
- 用细粒度 permission 控制每个工具；
- 同时支持 TUI、脚本和 HTTP server；
- 对工作区变更提供 snapshot、diff、revert 和 session recovery。

### 7.2 能力与调用机制

| 能力 | 观察到的机制 |
|------|--------------|
| Built-in tools | `bash`、`read`、`grep`、`glob`、`edit`、`write`、`apply_patch`、`lsp`、`skill`、`todowrite`、`webfetch`、`websearch`、`question` |
| Permission | 按 tool name allow、ask、deny；支持通配符和 per-agent override |
| Agent | 配置模型、prompt、工具和权限的执行配置 |
| Command | Prompt template，可带参数、agent 和 model；通过 `/name` 调用 |
| Provider | 内置 Provider 和自定义 OpenAI-compatible Provider；显式配置 context/output limits |
| Session | continue、fork、abort、share、summarize、revert |
| Workspace recovery | snapshot、diff、revert、undo |
| Host | TUI、`opencode run`、`opencode serve` HTTP server |
| External capability | Custom tools、MCP、LSP、Skills |

OpenCode 的调用入口分成三类：

```text
TUI
  → interactive prompt
  → Agent loop
```

```text
opencode run
  → non-interactive prompt
  → Agent loop
  → output
```

```text
opencode serve
  → HTTP API
  → Session / Message / Tool / Permission
  → Agent runtime
```

Custom Command 本质上是 Prompt Template：命令参数、shell output、file reference 等被填充后，再调用选定 Agent/Model。

### 7.3 关键取舍

- 将工具权限直接绑定到底层 tool identity；
- 将 Agent 作为执行配置，将 Command 作为用户触发的工作流模板；
- 将 TUI、脚本和 HTTP server 置于同一个 runtime 之上；
- 通过 snapshot 和 revert 处理工作区级恢复。

### 7.4 对 MoonTide 的观察

可借鉴：tool identity 权限、Agent/Command 分离、Provider/Model 解耦、TUI/headless/server 共用 Runtime 的方向。

需要验证：snapshot 是否应该成为 MoonTide 的 Session 能力，还是应保持为外层 workspace/change 管理能力；两者不能默认等同。

## 8. 跨竞品能力结论

### 8.1 基础能力

五个产品都需要：

1. Context acquisition：文件、搜索、项目规则和工具结果；
2. Agent loop：model request、tool call、tool result、继续或停止；
3. Workspace mutation：edit、write、patch、bash、test；
4. Permission/governance：allow、ask、deny、sandbox、network；
5. Session continuity：save、resume、fork、compact、revert；
6. Host integration：TUI、headless、SDK、RPC 或 server。

### 8.2 差异化能力

| 产品 | 最突出的差异化方向 |
|------|--------------------|
| Pi | 最小核心和强扩展 |
| Codex | 本地执行治理和结构化 Runtime protocol |
| Claude Code | 编码工作流和扩展生态 |
| CodeWhale | 多 Provider、多 Role 和 repo-level governance |
| OpenCode | Provider-neutral、配置化和服务化 |

### 8.3 重要判断

竞品的表面功能虽然不同，但它们都在围绕同一个事实源与执行循环构建外围能力：

```text
Context → Model → Tool → Policy → Executor → Event → Session
```

因此 MoonTide 的第一性问题不是“是否补齐 `/resume`、`/compact`、`/fleet`”，而是确认上述每一层由谁拥有、如何传递状态、如何记录事实、如何恢复失败。

## 9. MoonTide 的研究决策

| 观察 | MoonTide 决策 | 当前阶段 |
|------|---------------|----------|
| 小型基础工具足以支撑核心 coding loop | 采用 `read`、`grep`、`find`、`ls`、`bash` 等组合式方向 | 当前/近期 |
| Session 是恢复事实源 | 继续以 Session Item Log 为 canonical source | 当前 |
| Model request 是编译产物 | 保持 `materialize → compile → ModelRequest` 边界 | 当前 |
| Tool Call 需要结构化结果 | 保持 ToolSpec、executor、validation、ToolResult 和 TurnEvent 分离 | 当前 |
| Permission 需要 Runtime 治理 | 保持由组合根声明、由 loop 检查的 permission boundary | 当前 |
| Compaction 和 Memory 很常见 | 先记录为能力候选，等上下文规模需求出现后架构对齐 | 后置 |
| Subagent/Fleet 很常见 | 先保留 capability，暂不引入 scheduler 或多 Agent 实现 | 后置 |
| 多 Provider/远程 endpoint 有产品价值 | 纳入成熟产品方向，保持 agent-core LLM provider-neutral | 成熟产品 |
| Plugin/MCP/Hook 需要分化 | 不建立万能扩展接口；按 Tool、Skill、Command、Hook、MCP 分别评估 | 后置/按需 |
| Snapshot/revert 有恢复价值 | 先区分 Session recovery 与 Workspace change recovery | 待验证 |

## 10. 主要来源

- [Pi Documentation](https://pi.dev/docs/latest)
- [Pi Usage](https://pi.dev/docs/latest/usage)
- [Pi Sessions](https://pi.dev/docs/latest/sessions)
- [Pi Compaction](https://pi.dev/docs/latest/compaction)
- [Pi Extensions](https://pi.dev/docs/latest/extensions)
- [Pi RPC Mode](https://pi.dev/docs/latest/rpc)
- [OpenAI Codex CLI](https://learn.chatgpt.com/docs/codex/cli/)
- [OpenAI Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Claude Code: How it works](https://code.claude.com/docs/en/how-claude-code-works)
- [Claude Code: Extend Claude Code](https://code.claude.com/docs/en/features-overview)
- [Claude Code: Permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code: Hooks](https://code.claude.com/docs/en/hooks)
- [CodeWhale repository](https://github.com/davidste/codewhale)
- [CodeWhale Guide](https://github.com/Hmbown/CodeWhale/blob/main/docs/GUIDE.md)
- [OpenCode Tools](https://opencode.ai/docs/tools)
- [OpenCode Agents](https://opencode.ai/docs/agents/)
- [OpenCode CLI](https://dev.opencode.ai/docs/cli/)
- [OpenCode Server](https://dev.opencode.ai/docs/server/)
- [OpenCode Providers](https://opencode.ai/docs/providers)
