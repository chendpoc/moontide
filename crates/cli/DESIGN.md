# cli — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** CLI R1 已实现；REPL、interactive approval 与 Ctrl-C 属于后续 R2/R3。
> **关联：** [`../agent/DESIGN.md`](../agent/DESIGN.md) · [`../agent-core/src/loop/DESIGN.md`](../agent-core/src/loop/DESIGN.md)

---

## 1. 职责与边界

| 做 | 不做 |
|----|------|
| clap 参数解析 | AgentLoop/Session 状态机 |
| 环境变量解析 | 直接写 Session |
| AgentConfig 组装 | provider HTTP/SSE |
| one-shot / REPL | ToolRegistry/permission 查表 |
| approval 交互 | scheduler |
| final ModelResponse 渲染 | Agent Event derive/storage |
| Ctrl-C → CancellationToken | 自己保存对话历史 |

---

## 2. 模块结构（目标）

```text
crates/cli/
  Cargo.toml
  README.md
  DESIGN.md
  src/
    main.rs              # tokio runtime + exit code
    args.rs              # clap CliArgs
    config.rs            # args/env/defaults → AgentConfig
    repl.rs              # command loop
    approval.rs          # ToolApprovalHandler over stdin/stderr
    render.rs            # final ModelResponse → stdout
    tests.rs
```

CLI 不创建第二套 domain model；`CliArgs`、REPL command 与 render DTO 都是壳内私有类型。

---

## 3. 启动状态机

```text
main
  → CliArgs::parse
  → resolve_cli_config
  → Agent::create | Agent::resume
  → print session id to stderr
  → if prompt: run one-shot
  → else: run REPL
```

配置优先级：

```text
explicit CLI flag > fixed provider default > cwd-based path default
DEEPSEEK_API_KEY is required environment input
```

初版 provider 固定为 `AdapterFamily::OpenAiChatCompletions`；`--base-url` 允许替换 endpoint root，但不增加通用 preset registry。

---

## 4. `CliArgs` 与配置解析

```rust
struct CliArgs {
    session: Option<String>,
    prompt: Option<String>,
    cwd: Option<PathBuf>,
    sessions_dir: Option<PathBuf>,
    runs_dir: Option<PathBuf>,
    model: String,
    base_url: String,
}

fn resolve_agent_config(args: &CliArgs) -> anyhow::Result<AgentConfig>;
```

解析规则：

1. `cwd` 缺省为 `current_dir()`；
2. sessions/runs 缺省为 cwd 下 `.moontide` 子目录；
3. model 缺省 `deepseek-chat`；
4. base URL 缺省 `https://api.deepseek.com`；
5. API key 只从 `DEEPSEEK_API_KEY` 读取，缺失即配置错误；
6. 初版固定 `max_tokens`、`max_steps` 为 CLI 内部默认常量，后续再暴露参数；
7. 工具 names 与 permission map 使用 coding preset 固定值；
8. approval handler 注入交互式 stdin/stderr 实现；
9. `AgentConfig.system_prompt` 不由 CLI 拼接，agent 内部解析 Harness + Project Instructions。

---

## 5. REPL

```text
loop:
  line = rustyline.readline(" > ")
  if line == /exit: break
  if line == /id: print Agent::session_id to stderr; continue
  if line == /help: print commands; continue

  token = CancellationToken::new()
  ctrl_c = tokio::signal::ctrl_c()
  select:
    result = agent.turn(line, token.clone()) → render/error
    ctrl_c → token.cancel(); await turn cleanup; print cancelled
```

REPL 不把 Ctrl-C 转换为新的 SessionItem；Loop 负责 cleanup 与事实配对。Turn error 打印到 stderr 后回到下一次 readline。

---

## 6. Approval

CLI 的 approval handler 是 agent-core `ToolApprovalHandler` 的一个壳实现：

```rust
struct StdinApproval;

impl ToolApprovalHandler for StdinApproval {
    fn request<'a>(
        &'a self,
        call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<ToolApproval>> + Send + 'a>>;
}
```

要求：

- prompt 写 stderr，不污染 assistant stdout；
- 显示 tool name 与安全截断后的 input JSON；
- `y` → Approved；`n`/空输入 → Denied；EOF/输入错误 → Cancelled 或 Err；
- 不修改 AgentConfig permission map；
- 不通过 Hook 参与决策。

---

## 7. Render

初版只渲染最终 `ModelResponse`：

```text
ContentBlock::Text      → stdout
ContentBlock::Thinking  → 默认隐藏（后续 --thinking）
ToolUse                 → 不作为 terminal output（由 Loop 消费）
ToolResult              → 不应出现在 terminal response
```

CLI 不直接消费 `ModelStreamEvent` 或 `ModelResponseSnapshot`；流式 UI 属后续壳能力。

---

## 8. 错误与退出码

| 场景 | one-shot | REPL |
|------|----------|------|
| 参数/env/config 错误 | stderr + non-zero exit | 启动失败 |
| Agent create/resume 错误 | stderr + non-zero exit | 启动失败 |
| Turn/provider/tool 错误 | stderr + non-zero exit | 打印 ERROR，继续 |
| Ctrl-C cancellation | stderr + non-zero exit | 打印 cancelled，继续 |
| `/exit` | zero exit | zero exit |

CLI 不对 anyhow error 重新建模；只负责格式化诊断和退出策略。

---

## 9. import 边界

```text
cli → agent
cli → clap / rustyline / tokio::signal / std::env

cli ↛ agent-core
cli ↛ agent-tools
cli ↛ scheduler
```

---

## 10. 单测方向

- args/env/default precedence；
- missing `DEEPSEEK_API_KEY` 与 invalid path 启动失败；
- create/resume/one-shot/REPL dispatch；
- `/id`、`/help`、`/exit` 不进入 Agent Turn；
- approval y/n/empty/EOF 映射；
- stdout 只含 final assistant text，approval/diagnostics 在 stderr；
- Ctrl-C 调用 token.cancel 并等待 Agent turn future cleanup；
- Turn error 在 REPL 后续输入仍可执行。
