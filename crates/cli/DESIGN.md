# cli — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** CLI R1/R2/R3/R4 与 R5 Progress/diagnostic status consumption 已实现；R5 待 Review。
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
    config.rs            # args/env/settings/defaults → AgentConfig
    repl.rs              # command loop
    approval.rs          # ToolApprovalHandler over stdin/stderr
    settings_ui.rs         # crossterm /settings overlay
    setting_catalog.rs     # SettingItem catalog + fuzzy filter + apply effects
    fuzzy.rs               # Pi-compatible fuzzy filter
```

CLI 不创建第二套 domain model；`CliArgs`、REPL command 与 render DTO 都是壳内私有类型。

---

## 3. 启动状态机

```text
main
  → CliArgs::parse
  → if interactive: InputOwner + Settings Preflight
  → if one-shot: env/config validation
  → load GlobalConfigStore → AgentConfig
  → if interactive without --session: read latest session id only
  → if explicit --session/one-shot: Agent::resume | Agent::create
  → if prompt: run one-shot
  → else: run REPL; create Agent on first ordinary message
```

配置优先级：

```text
other settings: explicit CLI flag > settings.json > environment > fixed default
API key: --api-key > DEEPSEEK_API_KEY > settings.json > interactive input
```

`settings.json` 位于 `<cwd>/.moontide/settings.json`，schema 从 `version: 1` 开始。`CliArgs` 对可覆盖字段使用 `Option<T>`，以区分“未传入”和“显式传入”。CLI 负责 JSON schema、读取、版本校验和优先级；`agent::platform` 负责项目路径和设置文件原子替换。

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
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    approval_policy: Option<ApprovalPolicyArg>,
    trace: Option<TraceModeArg>,
}

fn resolve_agent_config(args: &CliArgs) -> anyhow::Result<AgentConfig>;
```

解析规则：

1. `cwd` 缺省为 `current_dir()`；
2. sessions/runs 缺省为 cwd 下 `.moontide` 子目录；相对覆盖路径以 resolved cwd 为基准；
3. settings 文件缺失时 model/base URL/approval/trace 使用固定默认值；
4. API key 按 `--api-key` > `DEEPSEEK_API_KEY` > settings.json > interactive input 解析；
5. `max_tokens`、`max_steps` 和 thinking level 从 settings.json 加载，缺失时使用 CLI 默认值；
6. 工具 names 与 permission map 使用 coding preset 固定值；
7. approval handler 注入交互式 stdin/stderr 实现；
8. `AgentConfig.system_prompt` 不由 CLI 拼接，agent 内部解析 Harness + Project Instructions。

interactive Settings Preflight 在 Agent create/resume 之前运行。CLI、环境或 settings.json 已存在 API key 时跳过 key 输入；缺失时隐藏输入。显式空 key 在读取 settings.json 前直接失败。one-shot 不进入 Settings，缺失 key 直接返回配置错误。

`ApprovalPolicy::Always` 将所有启用工具映射为 `Ask`；`Default` 使用 coding preset；`AlwaysAllow` 将所有启用工具映射为 `Allow` 且不注入 approval handler。`AlwaysAllow` 只在 Settings 输入 `ALLOW` 后生效。策略只属于 CLI runtime settings，不新增 agent-core policy 模块。

`--trace events` 使用 `AgentProgressObserver` 展示安全语义事件；`--trace events-thinking` 额外展示 provider 返回的 Thinking。两者均输出到 stderr，不引入 OTel 或 trace/span identity。

---

## 5. REPL

```text
global_config_store = preflight() # settings.json is read at this lifecycle boundary
if --session:
  agent = resume(global_config_store, session_id)
else:
  print latest persisted session id and resume hint
  agent = None
input_owner = global_config_store.input_owner

loop:
  line = input_owner.readline(" > ")
  if line == /exit: break
  if line == /settings: crossterm overlay; continue
  if line == /id: print Agent::session_id or "no active session"; continue
  if line == /help: print commands; continue
  if agent is None: agent = Agent::create(global_config_store)

  token = CancellationToken::new()
  ctrl_c = tokio::signal::ctrl_c()
  select:
    result = agent.turn(line, token.clone()) → render/error
    ctrl_c → token.cancel(); await turn cleanup; print cancelled
```

REPL 不把 Ctrl-C 转换为新的 SessionItem；Loop 负责 cleanup 与事实配对。Turn error 打印到 stderr 后回到下一次 readline。

### `/settings` overlay

- 命令：`/settings`；Pi 风格 hint：`Type to search · ↑↓ select · Enter/Space change · Esc cancel`
- UI：`crossterm` raw mode + alternate screen；逐键 filter（Pi fuzzy + token 分词）；↑↓ 选择
- Catalog 仅含用户向 agent 设置：model、base-url、api-key（masked）、approval-policy、trace、thinking-level、max-steps、max-tokens、cwd（只读）
- 不含 session-id、runs-dir、tools（Session 列表与 plugin 负责）
- 生效策略：`NextTurn`（max-* / thinking）、`ReloadAgent`（model / provider / approval / trace）、`ReadOnly`
- 持久化：运行中的 mutation 同时更新 `GlobalConfigStore` 与 `<cwd>/.moontide/settings.json`；文件带 `version: 1`，使用 `agent::platform` 的同目录临时文件原子替换；JSON 只在 start/reload/restart 边界读取；第一版约束单 workspace 单 writer

---

## 6. Approval

CLI 的 approval handler 是 agent-core `ToolApprovalHandler` 的一个壳实现，并通过唯一 InputOwner 读取终端：

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
- Settings、REPL、approval 不允许出现第二个 stdin reader。

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
Progress flush failure、worker `Degraded`/`Stopped` 和 `resync_required` 必须输出到 stderr；
resync 只提示宿主需要从 Session/turn result 重建状态，不在 CLI 内读取 Agent Event JSONL。

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
- interactive Settings 在 create/resume 前完成 API key 与 approval policy 解析；
- Turn error 在 REPL 后续输入仍可执行。
