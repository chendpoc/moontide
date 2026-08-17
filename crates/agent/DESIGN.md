# agent — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** 初步可用版 Agent R1/R2 已实现；CLI 接缝按后续 `cli` 模块实现。
> **关联：** [`../agent-core/src/loop/DESIGN.md`](../agent-core/src/loop/DESIGN.md) · [`../agent-tools/DESIGN.md`](../agent-tools/DESIGN.md) · [`../cli/DESIGN.md`](../cli/DESIGN.md)

---

## 1. 职责与边界

`agent` 是组合根，负责把已经存在的内核契约装配成一个可运行 Session。

| 做 | 不做 |
|----|------|
| provider preset 与显式配置解析结果装配 | 读取环境变量（由 CLI/宿主解析） |
| Session create/load | Session Item Log 直接写入 |
| agent-tools catalog → ToolRegistry | 复制 ToolRuntime/Loop 状态机 |
| permission map + approval handler 注入 | scheduler、并发 ToolExecutor |
| Harness/Project → SystemPrompt | 将 UserMessage 拼入 SystemPrompt |
| Agent Event recorder 与 EventDispatcher | OTel、sidecar、A2A |
| AgentLoop ownership | CLI 参数、REPL、stdout 渲染 |

依赖方向固定：

```text
cli ─────────────► agent ─────────────► agent-core
                    │                    ▲
                    └────────────► agent-tools
agent-tools ────────────────────────────┘
```

---

## 2. 模块结构（目标）

```text
crates/agent/
  Cargo.toml
  README.md
  DESIGN.md
  src/
    lib.rs
    config.rs             # ProviderConfig / AgentConfig
    bootstrap.rs          # create/resume 装配
    prompt.rs             # Harness + AGENTS.md → SystemPrompt
    agent.rs              # Agent facade → AgentLoop
    tests.rs
```

Agent Event 的具体 file adapter 暂时复用 `agent-core::event::FileAgentEventRecorder`；待 agent crate 稳定后再评估是否迁移文件适配器，不在初版复制实现。

---

## 3. 类型与签名

```rust
pub struct ProviderConfig {
    pub family: agent_core::llm::adapter::AdapterFamily,
    pub base_url: String,
    pub api_key: String,
}

pub struct AgentConfig {
    pub cwd: PathBuf,
    pub sessions_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub provider: ProviderConfig,
    pub model: String,
    pub max_tokens: u32,
    pub thinking_level: Option<ThinkingLevel>,
    pub max_steps: u32,
    pub tool_names: Vec<String>,
    pub permissions: ToolPermissionMap,
    pub approval: Option<Arc<dyn ToolApprovalHandler>>,
    pub progress: Option<Arc<dyn ProgressObserver>>,
}

pub struct Agent {
    loop_: AgentLoop,
    session_id: String,
}

impl Agent {
    pub fn create(config: AgentConfig) -> anyhow::Result<Self>;
    pub fn resume(config: AgentConfig, session_id: &str) -> anyhow::Result<Self>;
    pub fn session_id(&self) -> &str;
    pub async fn turn(
        &mut self,
        text: String,
        cancellation: CancellationToken,
    ) -> anyhow::Result<ModelResponse>;
}
```

`Agent` 不实现 Clone；`loop_` 是唯一运行时 owner。`session_id` 由 SessionStore header 得到，不能由 caller 自行覆盖。

---

## 4. 装配算法

### 4.1 Provider

```text
ProviderConfig
  → AdapterConfig { base_url, api_key }
  → llm::adapter::build_provider(family, adapter_config)
  → Arc<dyn LLMProvider>
```

`agent` 不直接 import provider adapter 的具体实现，只使用当前公开的 `AdapterFamily`、`AdapterConfig` 和 `build_provider` seam。

### 4.2 Tools

```text
config.tool_names
  → agent_tools::builtin_tool_definitions()
  → name lookup
  → ToolDefinition::build()
  → ToolRegistry::new(Vec<Tool>)
  → ToolRuntime::new(registry, permissions, approval)
```

未知 tool name、重复工具、permission key 漂移或 Ask 缺 handler 都在 bootstrap 失败；不延迟到第一轮模型调用。

### 4.3 Session 与 events

```text
create: SessionStore::create(sessions_dir, cwd)
resume: SessionStore::load(sessions_dir, session_id)
session_id = store.header().session_id.clone()
legacy_run_id = new UUID（只用于 Agent Event 分区）
recorder = FileAgentEventRecorder::new(runs_dir, legacy_run_id)
hooks = [DeriveAgentEventHook(recorder)]
events = EventDispatcher::new(PipelineRegistry::builder().hook(...).build_frozen(), TraceContext)
```

EventDispatcher 不拥有 SessionStore；AgentLoopInit 一次性转移 store/provider/tools/events 所有权。

### 4.4 Prompt

```text
project_instructions = load AGENTS.md from cwd ancestors (root → cwd)
harness_prompt = render static agent-owned contract + dynamic cwd/session/tools facts
system_prompt = compose(project_instructions, harness_prompt)
```

Harness contract 不接受 CLI 覆盖。Project Instructions 不是 SessionItem，不进入 Session Item Log；`TurnInput.text` 仍作为 UserMessage。
SystemPrompt 在每个 user Turn 边界解析一次；同一 Turn 的多个 model step 复用该 immutable 值。

初版加载错误策略：存在但无法读取的 `AGENTS.md` 返回 bootstrap error，避免静默丢失项目约束；无文件视为空 instructions。

---

## 5. `Agent::turn`

每次调用构造新的 crate-private runtime input：

```rust
TurnInput {
    text,
    config: ModelRequestConfig {
        model: config.model.clone(),
        max_tokens: config.max_tokens,
        thinking_level: config.thinking_level,
        session_id: Some(self.session_id.clone()),
    },
    system_prompt: resolve_system_prompt(&self.cwd, &self.session_id, &self.tool_names, &self.permissions),
    policy: TurnPolicy {
        max_steps: config.max_steps,
        max_llm_retries: 3,
    },
}
```

然后只调用 `AgentLoop::turn(input, cancellation)`。Agent 不复制 Turn/Step/tool round 控制流。

---

## 6. 配置校验

bootstrap 必须拒绝：

1. 空 base URL；
2. 空 model；
3. `max_tokens == 0`；
4. `max_steps == 0`；
5. `tool_names` 中不存在的 catalog name；
6. registry 与 permission map key 集不一致；
7. Ask permission 没有 approval handler；
8. sessions/runs 路径不可创建或读取；
9. Project `AGENTS.md` 存在但不可读取。

Agent 不在 bootstrap 时验证 provider 网络可达性；第一次 Turn 的 provider error 仍由 Loop 返回。

---

## 7. import 边界

```text
agent → agent-core::{event, llm, loop, model_input, session, tools}
agent → agent-tools
agent ↛ cli
agent ↛ scheduler
agent ↛ provider adapter concrete modules

cli → agent
agent-core ↛ agent / cli / agent-tools
```

`ProgressEvent` / `ProgressObserver` 是 agent 对上层宿主暴露的只读进度投影；其来源是 agent-core `TurnEvent`，不持久化、不携带 OTel trace/span identity，不允许影响 Loop、permission、retry 或 cancellation。

---

## 8. 错误与生命周期

- `create/resume` 失败不产生可运行 Agent；
- `Agent::turn` 错误不回滚已提交 Session facts；
- Agent 可在 facts 仍可 materialize 时继续下一 Turn；
- Agent Event Hook/recorder fail-open，不覆盖 Session commit error；
- Agent drop 只释放运行时句柄，Session Item Log 已落盘事实保留；
- 同一 Agent 串行调用 Turn；并发调用者须自行在更高层协调。

---

## 9. 决策记录

1. agent 是唯一组合根，不把装配逻辑塞入 cli 或 agent-core；
2. AgentConfig 接收显式解析值，agent 不读取环境变量；
3. AgentLoop 是唯一 Session runtime owner；
4. Harness System Prompt 与 Project Instructions 由 agent 组合，UserMessage 保持独立；
5. 初版默认 DeepSeek/OpenAI-compatible provider；
6. 默认工具 read/find/grep Allow，write/edit/bash Ask；
7. scheduler、delegate、offload、multi-agent 后置。

---

## 10. 单测方向

- ProviderConfig → AdapterConfig 映射；
- create/resume Session identity 与独立 legacy run partition；
- catalog tool selection、未知 name、permission key mismatch；
- Ask 无 handler 拒绝，approval handler 注入；
- AGENTS.md ancestor 合并顺序、缺失与读取错误；
- Harness prompt 包含 cwd/session/tool facts 且不混入 UserMessage；
- Agent 多 Turn 复用同一 SessionStore；
- Agent 不直接 commit_item、不 import scheduler/cli；
- bootstrap 错误不产生半装配 Agent。
