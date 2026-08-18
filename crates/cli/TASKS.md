# cli 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

状态约定：`☑` = 实现与测试完成；`◐` = 实现与测试完成，等待 Review 或集成门禁；`☐` = 未开始。

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|----|------|------|-----------|------|
| **R1** | 01 | crate scaffold、args/config、one-shot | ~550 行 | ◐ Review |
| **R2** | 02–03 | REPL、approval、render、Ctrl-C 与测试 | ~850 行 | ◐ Review |
| **R3** | 04 | Settings Preflight、InputOwner 与 runtime settings | ~500 行 | ◐ Review |
| **R4** | 05 | `/settings` overlay、catalog 与 fuzzy filter | ~700 行 | ◐ Review |

## TASK 明细

### TASK-cli-01: Crate scaffold、参数解析与 one-shot

- **做什么：** 将 `cli` 加入 workspace，建立 `moontide` binary、clap args 和 env/default → AgentConfig 解析；打通 create/resume + `--prompt` one-shot，stdout/stderr/exit code 边界固定。
- **依赖：** agent R1（TASK-agent-01/02）
- **范围：** 根 `Cargo.toml`、`Cargo.lock`、`crates/cli/Cargo.toml`、`crates/cli/src/main.rs`、`args.rs`、`config.rs`、`render.rs`、`tests.rs`
- **预估 diff：** ~550 行
- **完成标准：** `cargo test -p cli`；四种启动组合（create/resume × prompt/REPL dispatch）中 one-shot、missing key、invalid path 与 output boundary 通过。
- **状态：** ◐ Review

### TASK-cli-02: REPL 与交互式 approval

- **做什么：** 实现 rustyline REPL `/id`、`/help`、`/exit`，把普通输入交给 Agent::turn；实现 stderr approval handler，支持 y/n/empty/EOF 和 ToolResult/Turn error 后继续输入。
- **依赖：** TASK-cli-01
- **范围：** `crates/cli/src/repl.rs`、`approval.rs`、`render.rs`、`main.rs`、`tests.rs`
- **预估 diff：** ~550 行
- **完成标准：** REPL command/approval/output tests；Turn error 后下一输入仍可执行；CLI 不直接 import agent-core。
- **状态：** ◐ Review

### TASK-cli-03: Ctrl-C cancellation 与 shell conformance

- **做什么：** 将 Ctrl-C 映射为每 Turn 的 CancellationToken，等待 Agent cleanup 后继续 REPL；补齐 CLI import boundary、exit code、workspace integration 和文档状态。
- **依赖：** TASK-cli-02
- **范围：** `crates/cli/src/main.rs`、`repl.rs`、`tests.rs`、`PROGRESS.md`、顶层 checklist
- **预估 diff：** ~300 行
- **完成标准：** workspace fmt/clippy/test；Ctrl-C cancellation 与后续 turn、stdout/stderr 和 CLI → agent 依赖守门通过。
- **状态：** ◐ Review

### TASK-cli-04: Settings Preflight 与共享输入所有权

- **做什么：** 在 Agent create/resume 前解析 interactive runtime settings；让 REPL 与 approval 共享单一 InputOwner，并接入 trace、thinking 与 turn limit 的 CLI 设置。
- **依赖：** TASK-cli-03
- **范围：** `crates/cli/src/input.rs`、`settings.rs`、`config.rs`、`trace.rs`、`main.rs`、`tests.rs`
- **预估 diff：** ~500 行
- **完成标准：** interactive key/approval policy/confirmation、shared input owner、runtime settings 与 trace tests 通过。
- **状态：** ◐ Review

### TASK-cli-05: `/settings` overlay 与 catalog

- **做什么：** 实现 crossterm alternate-screen settings overlay、逐键 fuzzy filter、setting catalog 与 NextTurn/ReloadAgent/NextLaunch/ReadOnly 生效边界。
- **依赖：** TASK-cli-04
- **范围：** `crates/cli/src/fuzzy.rs`、`setting_catalog.rs`、`settings_ui.rs`、`settings.rs`、`repl.rs`、`main.rs`、`tests.rs`
- **预估 diff：** ~700 行
- **完成标准：** catalog 排除 session/runs/tools，筛选与 setting cycle 测试通过；always-allow 必须显式输入 `ALLOW`；退出或错误后 raw mode 与 alternate screen 均恢复。
- **状态：** ◐ Review

## 实现约束

- CLI 不直接 import agent-core、agent-tools 或 scheduler；
- API key 只由 CLI 读取 `DEEPSEEK_API_KEY`，不写入 Session/日志；
- 不实现流式 snapshot UI、GUI、多 session 并发、`/new`、scheduler 或 subagent；
- 公开 Agent API 改动必须回到 agent 架构对齐；
- 每批实现后停等用户 Review 和 `commit`。
