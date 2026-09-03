# agent

> **性质：** MoonTide 组合根的对外契约。
> **状态：** 初步可用版 Agent R1–R3 已实现；CLI 宿主基线已完成，Desktop v0.1 接入准备中。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。
> **关联：** [`../agent-core/README.md`](../agent-core/README.md) · [`../agent-tools/README.md`](../agent-tools/README.md) · [`../cli/README.md`](../cli/README.md)

---

## 这是什么

`agent` 是唯一的组合根。它把 provider、Session、第一方工具、permission、approval、Progress、AgentLoop 和可选 Agent Event Log 装配起来；诊断日志默认关闭。

```text
AgentConfig（显式解析值）
      │
      ├─ ResolvedProviderConfig → typed AdapterConfig → LLMProvider
      ├─ tool_names → agent-tools catalog → ToolRegistry
      ├─ permissions + approval → ToolRuntime
      ├─ create/load SessionStore
      ├─ Harness + Project Instructions → SystemPrompt
      ├─ EventDispatcher + Progress Hook
      ├─ ProgressWorker（可选 frontend observer）
      └─ Agent Event Log（R3 diagnostic persistence）
                    │
                    ▼
             AgentLoop::new(AgentLoopInit)
```

`agent` 不读取用户输入、不实现 REPL、不直接写 Session；这些分别由 `Agent::turn` 和 `cli` 负责。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`cli`** | 构造 `AgentConfig`、注入 approval handler、调用 `Agent::create/resume/reload/turn` | 直接 import SessionStore/ToolRegistry/EventDispatcher |
| **桌面/HTTP 入口** | 复用同一 Agent API，提供自己的 approval 与 cancellation | 复制 AgentLoop 状态机 |
| **`agent-core`** | 提供 provider/session/tools/event/loop 契约 | 反向依赖 agent |
| **`agent-tools`** | 提供第一方 ToolDefinition catalog | 决定 permission 或 session 生命周期 |
| **测试** | 注入 mock provider、approval、路径和显式配置 | 读取真实 API key 或网络 |

---

## 公开入口

- `AgentConfig`、`ResolvedProviderConfig`、`PersistenceConfig` — 宿主注入的显式配置（`agent` 不读环境变量）
- `Agent::create` / `resume` / `reload` / `turn` — Session 生命周期与单 Turn 入口（须在 Tokio runtime 内）
- `SessionQuery`、`latest_session_id` — 只读 Session 列举与查询（不创建 runtime `Agent`）
- `ProjectPaths::resolve`、`write_settings_atomically` — 跨平台项目路径与设置原子写
- `ProgressObserver`、`ProgressStatus` — TurnEvent 派生的只读 UI 观测（fail-open，不参与 Loop 决策）
- `AgentEventLogStatus`、`flush_agent_event_log` — 可选诊断日志（默认 `DiagnosticPersistence::Off`）

完整类型签名与字段见 [`DESIGN.md`](DESIGN.md) §4。

`AgentEventLogState`、`AgentEventLogStatus` 和 `AgentEventLogHandle` 由 crate root 导出；诊断 recorder 或 worker 启动失败不会阻断 Agent，宿主通过 `agent_event_log_status()` 和 `flush_agent_event_log()` 读取并暴露该错误。

### 平台路径策略

`agent::platform` 是宿主共用的项目路径 seam：解析 `cwd` / sessions / runs / settings 路径，并提供设置文件原子替换；不读环境变量、不解析设置 JSON，也不拥有 Session Item Log。

相对路径以 resolved `cwd` 为基准；默认目录为 `<cwd>/.moontide/sessions`、`<cwd>/.moontide/runs` 和 `<cwd>/.moontide/settings.json`。普通解析只做绝对化，不默认 `canonicalize`。CLI/其他宿主负责设置 schema、优先级、环境变量和 JSON 读写；`agent-core` 不依赖该 module。

`ProgressObserver` 接收由 TurnEvent 派生的安全 `ProgressEvent`，用于 CLI、Desktop 或 HTTP 展示；它是只读、fail-open 的观察接缝，不参与 Loop 决策，也不等同于 OTel trace/span。

`Agent::create`、`Agent::resume` 和 `Agent::reload` 要求调用方已经运行在 Tokio runtime 内。无 runtime 不提供同步 Progress observer fallback。

Agent Event Log 的 R3 设计与实现见 [`DESIGN.md`](DESIGN.md#log)；默认不装配。Progress 的 snapshot/finalized 语义见 [`DESIGN.md`](DESIGN.md#progress)。

## 子模块索引

| 子模块 | 设计锚点 | 源码 |
|--------|----------|------|
| Progress | [§8 Progress](DESIGN.md#progress) | `src/progress.rs` |
| Agent Event Log | [§9 Log](DESIGN.md#log) | `src/log/` |
| Platform | [§10 Platform](DESIGN.md#platform) | `src/platform/` |
| LLM catalog/merge | [`DESIGN.md`](DESIGN.md) §4.1 | `src/llm/` |
| Session query | [`DESIGN.md`](DESIGN.md) §4.3 | `src/session/` |

---

## SystemPrompt 分层

用户输入永远作为 `SessionItem::UserMessage`，不拼进 SystemPrompt。Agent 每个 Turn 使用稳定的解析结果：

```text
Project Instructions（AGENTS.md，root → cwd）
      +
Harness System Prompt（agent-owned，non-negotiable contract）
      ↓
SystemPrompt
      ↓
ModelRequest.system
```

Harness System Prompt 用于让模型理解：

- 当前 cwd、session、Turn/Step/Tool round 语义；
- 可用工具、permission/approval 和 cancellation 边界；
- Session Item Log 与 Agent Event Log 的区别；
- 工具预期失败、OutcomeUnknown 和不可伪造的结果语义；
- 当前初版 agent/CLI 的输出与错误边界。

Project Instructions 从 cwd 向上查找 `AGENTS.md`，按 root → cwd 顺序合并；不存在时为空。Harness contract 作为 agent-owned 约束附加在最终 SystemPrompt 中，不由 CLI 参数覆盖。

---

## Session 生命周期

```text
Agent::create(config)
  → SessionStore::create
  → AgentLoop::new

Agent::resume(config, session_id)
  → SessionStore::load
  → AgentLoop::new

Agent::reload(config).await
  → flush old diagnostic worker
  → SessionStore::load with the same session id
  → replace AgentLoop and optional diagnostic worker

Agent::turn(text, token)
  → TurnInput
  → AgentLoop::turn
```

同一个 `Agent` 可以连续执行多轮；CLI 不保存对话历史，历史只存在 Session Item Log。`Agent` 不实现 Clone，也不支持同一 Session 的并发 writer。

Session 默认目录由宿主通过 `agent::platform::ProjectPaths` 解析为 `<cwd>/.moontide/sessions`；Agent Event 的 R3 目录为 `<cwd>/.moontide/runs`。项目设置位于 `<cwd>/.moontide/settings.json`。默认 `SessionPersistence::Items + DiagnosticPersistence::Off`：创建 Session，运行 Progress，但不启动 Agent Event Log worker 或创建 active JSONL 文件。`runId` 由组合根生成，仅作为现有观测分区键，不恢复 Run 实体。

---

## 默认工具与 permission

初步可用 coding preset 默认选择 `agent-tools` 的：

```text
read / find / grep   → Allow
write / edit / bash  → Ask
```

`AgentConfig` 仍接收显式 `tool_names` 与 permission map，构造时由 ToolRuntime 校验 key 集；Ask 没有 approval handler 直接拒绝启动。CLI 初版不提供动态 `--tools` / `--permissions` 参数。

---

## 错误边界

- 配置、provider、Session、catalog、permission/approval 装配错误：`create/resume` 返回 `Err`；
- Turn 错误：由 `Agent::turn` 返回，CLI REPL 打印到 stderr 后继续；
- Session Item Log 仍是唯一恢复事实源；Agent Event recorder 故障 fail-open；
- agent 不吞 provider、Session 或 Loop 的基础设施错误。

---

## 非目标

- scheduler；
- subagent/delegate、A2A、sidecar；
- compaction、memory、retrieval；
- OTel trace/span；
- 多 Session 并发 writer；
- GUI、HTTP server 和复杂流式终端 UI。

实现范围与测试方向见 [`DESIGN.md`](DESIGN.md)。
