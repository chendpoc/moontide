# agent 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|----|------|------|-----------|------|
| **R1** | 01–02 | crate scaffold、配置/provider/tools/session bootstrap | ~850 行 | ☑ |
| **R2** | 03 | Harness + Project SystemPrompt、Agent facade、one-shot seam | ~240 行 | ☑ |

## TASK 明细

### TASK-agent-01: Crate scaffold 与显式配置

- **做什么：** 将 `agent` 加入 workspace，建立 `ProviderConfig` / `AgentConfig`，完成 provider config 与基础路径、model、max_tokens、max_steps 的校验。AgentConfig 只接收显式值，不读取环境变量。
- **依赖：** 无
- **范围：** 根 `Cargo.toml`、`Cargo.lock`、`crates/agent/Cargo.toml`、`crates/agent/src/lib.rs`、`config.rs`、`tests.rs`
- **预估 diff：** ~350 行
- **完成标准：** `cargo test -p agent`；无效 URL/model/path/zero bounds 被拒绝；agent-core/agent-tools 依赖方向正确。
- **状态：** ☑

### TASK-agent-02: Provider、tools、Session 与 Event bootstrap

- **做什么：** 实现 create/resume 的组合装配：provider、catalog tool selection、ToolRegistry/ToolRuntime、SessionStore、Agent Event recorder、PipelineRegistry/EventDispatcher 和 AgentLoopInit。未知 tool、permission 漂移、Ask 无 handler、Session/recorder 初始化错误在 bootstrap 阶段返回。
- **依赖：** TASK-agent-01
- **范围：** `crates/agent/src/bootstrap.rs`、`agent.rs`、`tests.rs`、必要的 `lib.rs`；不修改 agent-core/agent-tools 实现
- **预估 diff：** ~500 行
- **完成标准：** create/resume session identity、tool selection、permission validation、AgentLoop ownership conformance 测试通过。
- **状态：** ☑

### TASK-agent-03: Harness + Project SystemPrompt 与 Agent turn seam

- **做什么：** 在每个 user Turn 边界解析 cwd ancestor 的 `AGENTS.md` 与 agent-owned Harness contract，生成稳定的 `SystemPrompt` 并交给现有 AgentLoop。Project Instructions 读取失败必须显式返回错误，UserMessage 不进入 prompt。
- **依赖：** TASK-agent-01、TASK-agent-02
- **范围：** `crates/agent/src/prompt.rs`、`agent.rs`、`bootstrap.rs`、`tests.rs`
- **预估 diff：** ~240 行
- **完成标准：** ancestor 顺序、runtime facts、每 Turn reload、不可读文件拒绝与 workspace conformance 测试通过。
- **状态：** ☑

## 实现约束

- 不在 agent 复制 Turn/Step/Tool round 状态机；
- 不让 agent 读取环境变量；
- 不实现 scheduler、delegate、sidecar、OTel 或 CLI；
- `runId` 只作为 legacy Agent Event 分区键生成，不恢复 Run 实体；
- 公开签名改变必须回到架构对齐。
