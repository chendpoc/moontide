# agent

> **性质：** MoonTide 组合根的对外契约。
> **状态：** 初步可用版 Agent R1/R2 已实现并通过 workspace 检查；CLI 宿主基线已完成，Desktop v0.1 接入准备中。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。
> **关联：** [`../agent-core/src/loop/README.md`](../agent-core/src/loop/README.md) · [`../agent-tools/README.md`](../agent-tools/README.md) · [`../cli/README.md`](../cli/README.md)

---

## 这是什么

`agent` 是唯一的组合根。它把 provider、Session、第一方工具、permission、approval、Agent Event recorder 和 AgentLoop 装配起来，但不复制 Loop 的 Turn 状态机。

```text
AgentConfig（显式解析值）
      │
      ├─ ProviderConfig → LLMProvider
      ├─ tool_names → agent-tools catalog → ToolRegistry
      ├─ permissions + approval → ToolRuntime
      ├─ create/load SessionStore
      ├─ Harness + Project Instructions → SystemPrompt
      └─ EventDispatcher + legacy Agent Event recorder
                    │
                    ▼
             AgentLoop::new(AgentLoopInit)
```

`agent` 不读取用户输入、不实现 REPL、不直接写 Session；这些分别由 `Agent::turn` 和 `cli` 负责。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`cli`** | 构造 `AgentConfig`、注入 approval handler、调用 `Agent::create/resume/turn` | 直接 import SessionStore/ToolRegistry/EventDispatcher |
| **桌面/HTTP 入口** | 复用同一 Agent API，提供自己的 approval 与 cancellation | 复制 AgentLoop 状态机 |
| **`agent-core`** | 提供 provider/session/tools/event/loop 契约 | 反向依赖 agent |
| **`agent-tools`** | 提供第一方 ToolDefinition catalog | 决定 permission 或 session 生命周期 |
| **测试** | 注入 mock provider、approval、路径和显式配置 | 读取真实 API key 或网络 |

---

## 公开 API

```rust
pub struct ProviderConfig {
    pub family: agent_core::llm::adapter::AdapterFamily,
    pub base_url: String,
    pub api_key: String,
}

pub struct AgentConfig {
    pub cwd: std::path::PathBuf,
    pub sessions_dir: std::path::PathBuf,
    pub runs_dir: std::path::PathBuf,
    pub provider: ProviderConfig,
    pub model: String,
    pub max_tokens: u32,
    pub thinking_level: Option<agent_core::llm::protocol::ThinkingLevel>,
    pub max_steps: u32,
    pub tool_names: Vec<String>,
    pub permissions: agent_core::r#loop::ToolPermissionMap,
    pub approval: Option<std::sync::Arc<dyn agent_core::r#loop::ToolApprovalHandler>>,
    pub progress: Option<std::sync::Arc<dyn agent::ProgressObserver>>,
}

pub struct Agent {
    // private: owns one agent_core::loop::AgentLoop and stable session identity
}

impl Agent {
    pub fn create(config: AgentConfig) -> anyhow::Result<Self>;

    pub fn resume(
        config: AgentConfig,
        session_id: &str,
    ) -> anyhow::Result<Self>;

    pub fn session_id(&self) -> &str;

    pub async fn turn(
        &mut self,
        text: String,
        cancellation: tokio_util::sync::CancellationToken,
    ) -> anyhow::Result<agent_core::llm::protocol::ModelResponse>;
}
```

`AgentConfig` 只接收已经解析好的显式值。`agent` 不读取环境变量；CLI 或其他宿主负责把环境变量、参数和默认值解析成该结构。

`ProgressObserver` 接收由 TurnEvent 派生的安全 `ProgressEvent`，用于 CLI、Desktop 或 HTTP 展示；它是只读、fail-open 的观察接缝，不参与 Loop 决策，也不等同于 OTel trace/span。

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

Agent::turn(text, token)
  → TurnInput
  → AgentLoop::turn
```

同一个 `Agent` 可以连续执行多轮；CLI 不保存对话历史，历史只存在 Session Item Log。`Agent` 不实现 Clone，也不支持同一 Session 的并发 writer。

Session 默认目录由 CLI 解析为 `<cwd>/.moontide/sessions`；Agent Event 默认目录为 `<cwd>/.moontide/runs`。`runId` 由组合根生成，仅作为现有观测分区键，不恢复 Run 实体。

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
