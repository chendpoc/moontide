# agent — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** 初步可用版 Agent R1–R3 已实现；CLI 接缝按后续 `cli` 模块实现。
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
| EventDispatcher、Progress Hook 与可选 Agent Event diagnostic worker | OTel、sidecar、A2A |
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
    log/                  # R3 Agent Event diagnostic queue / worker / file persistence
    platform/              # ProjectPaths 与 settings 原子写入
    bootstrap.rs          # create/resume 装配
    prompt.rs             # Harness + AGENTS.md → SystemPrompt
    agent.rs              # Agent facade → AgentLoop
    tests.rs
```

Agent Event 的 queue、worker、persistence policy 和 file adapter 由 `agent::log` 实现；默认
`DiagnosticPersistence::Off` 不装配这些组件。`agent-core::event` 只提供
`AgentEventRecord`、derive mapping 和 `AgentEventRecorder` port。Progress worker 独立位于
`agent::progress`，是默认宿主事件路径。

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
    pub persistence: PersistenceConfig,
}

    pub enum SessionPersistence { Items, Disabled /* reserved */ }
pub enum DiagnosticPersistence { Off, Errors, Normal, Debug }
pub struct PersistenceConfig {
    pub session: SessionPersistence,
    pub diagnostic: DiagnosticPersistence,
}

pub struct Agent {
    loop_: AgentLoop,
    session_id: String,
}

impl Agent {
    pub fn create(config: AgentConfig) -> anyhow::Result<Self>;
    pub fn resume(config: AgentConfig, session_id: &str) -> anyhow::Result<Self>;
    pub async fn reload(&mut self, config: AgentConfig) -> anyhow::Result<()>;
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

`agent::SessionQuery` 是面向 CLI/Desktop 的只读 facade，底层调用
`agent-core::session::SessionQuery`。它只能读取和校验现有 Session Item Log，不取得
AgentLoop 的 SessionStore ownership，不创建第二 writer，也不改变 Agent resume 路径。

```text
create: SessionStore::create(sessions_dir, cwd)
resume: SessionStore::load(sessions_dir, session_id)
session_id = store.header().session_id.clone()
legacy_run_id = new UUID（保留为 trace context；启用 diagnostic policy 时用于 Agent Event 分区文件）
diagnostic = persistence.diagnostic
diagnostic == Off → 不注册 Agent Event Hook，不启动 diagnostic worker，不创建 runs 文件
Progress → 注册 Progress Hook（若 frontend 提供 observer）
diagnostic != Off → 注册 Agent Event Hook / worker
events = EventDispatcher::new(PipelineRegistry::builder().hook(progress?).build_frozen(), TraceContext)
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
agent::log → agent-core::event::{AgentEventRecord, AgentEventRecorder}
agent ↛ cli
agent ↛ scheduler
agent ↛ provider adapter concrete modules

cli → agent
agent-core ↛ agent / cli / agent-tools
```

`ProgressEvent` / `ProgressObserver` 是 agent 对上层宿主暴露的只读进度投影；其来源是 agent-core `TurnEvent`，不持久化、不携带 OTel trace/span identity，不允许影响 Loop、permission、retry 或 cancellation。Agent Event Log 的 R3 诊断 policy 不进入 `session` 或 `agent-core::event`。

R2 的 snapshot/finalized identity、事件顺序和 fail-open 细节见 [`src/progress/DESIGN.md`](src/progress/DESIGN.md)。

## 8. Platform paths and project settings

`agent::platform` 是宿主共用的跨平台路径 seam，不是包住所有 `std::fs` / `std::path` 的万能 common module。

### 8.1 `ProjectPaths`

```text
resolve(cwd, sessions_dir?, runs_dir?)
  → absolute cwd
  → relative overrides resolve against cwd
  → missing overrides default to cwd/.moontide/{sessions,runs}
  → settings_path = cwd/.moontide/settings.json
```

规则：

- 使用 `PathBuf` / `OsStr`，不把路径转为字符串再处理；
- 不拼接 `/` 或 `\\`；
- 不读取环境变量；
- 不默认调用 `canonicalize`；
- `cwd` 必须是现有目录；
- `sessions_dir` / `runs_dir` 可不存在，由宿主 bootstrap 创建和校验；
- 用户传入的绝对路径不被重定位。

Session/Run/Settings 均为项目本地 `.moontide` 布局；用户级 config/data/cache 目录不属于当前 module。

### 8.2 Settings persistence

设置 schema 由 CLI/frontend 拥有，第一版带显式 `version: 1`。`api_key` 可以持久化在项目设置中；它不进入 Session Item Log 或 Agent Event Log。

API key 优先级：`--api-key` > `DEEPSEEK_API_KEY` > `settings.json` > interactive input。其他设置优先级：显式 CLI 参数 > `settings.json` > 环境变量 > 默认值。CLI 参数必须使用 `Option<T>` 保留“未传入”和“显式传入”的区别。

`write_settings_atomically(path, bytes)` 在目标目录创建临时文件，写入完整 bytes 后以平台可用的替换语义更新目标文件。它不解析 JSON、不合并配置、不实现 concurrent writer；第一版约束一个 workspace 同时只有一个 settings writer。损坏或未知版本的 settings 文件由 frontend 显式报错并保留原文件。

### 8.3 Ownership

```text
agent::platform  → 路径解析、settings 原子替换
cli/frontend     → settings schema、JSON 解析、优先级、读写流程
agent            → AgentConfig 装配
agent-core       → Session Item Log / AgentLoop，不读取 settings.json
```

---

## 9. 错误与生命周期

- `create/resume` 失败不产生可运行 Agent；
- `create/resume/reload` 必须在 Tokio runtime 内调用；
- `Agent::turn` 错误不回滚已提交 Session facts；
- Agent 可在 facts 仍可 materialize 时继续下一 Turn；
- Agent Event Hook/worker fail-open，不覆盖 Session commit error；
- `Agent::reload` 在替换旧 diagnostic worker 前等待 flush；flush 失败则返回错误并保留旧运行时；
- Agent drop 只释放运行时句柄，Session Item Log 已落盘事实保留；
- 同一 Agent 串行调用 Turn；并发调用者须自行在更高层协调。

---

## 10. 决策记录

1. agent 是唯一组合根，不把装配逻辑塞入 cli 或 agent-core；
2. AgentConfig 接收显式解析值，agent 不读取环境变量；
3. AgentLoop 是唯一 Session runtime owner；
4. Harness System Prompt 与 Project Instructions 由 agent 组合，UserMessage 保持独立；
5. 初版默认 DeepSeek/OpenAI-compatible provider；
6. 默认工具 read/find/grep Allow，write/edit/bash Ask；
7. scheduler、delegate、offload、multi-agent 后置。

---

## 11. 单测方向

- ProviderConfig → AdapterConfig 映射；
- create/resume Session identity 与独立 legacy run partition；
- catalog tool selection、未知 name、permission key mismatch；
- Ask 无 handler 拒绝，approval handler 注入；
- AGENTS.md ancestor 合并顺序、缺失与读取错误；
- Harness prompt 包含 cwd/session/tool facts 且不混入 UserMessage；
- Agent 多 Turn 复用同一 SessionStore；
- Agent 不直接 commit_item、不 import scheduler/cli；
- bootstrap 错误不产生半装配 Agent。
- ProjectPaths 的相对/绝对路径解析在 macOS、Windows、Linux 保持同一契约；
- settings 原子写入不留下半个 JSON，目标文件替换失败时返回错误；
- settings writer 的单写者约束不被伪装成跨进程并发支持。
