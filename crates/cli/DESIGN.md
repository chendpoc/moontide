# cli — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** CLI R1–R5 与 Harness Console（直播 Progress、Session 命令）已实现。
> **关联：** [`../agent/DESIGN.md`](../agent/DESIGN.md) · [`../agent-core/DESIGN.md`](../agent-core/DESIGN.md#loop)

---

## 1. 职责与边界

| 做 | 不做 |
|----|------|
| clap 参数解析 | AgentLoop/Session 状态机 |
| 环境变量解析 | 直接写 Session |
| AgentConfig 组装 | provider HTTP/SSE |
| one-shot / Harness Console | ToolRegistry/permission 查表 |
| approval 交互 | scheduler |
| Progress 直播渲染 + ModelResponse fallback | Agent Event derive/storage |
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
    console.rs           # Harness Console command loop
    console_render.rs    # Progress → stdout/stderr live paint
    approval.rs          # ToolApprovalHandler over stdin/stderr
    settings_ui.rs         # crossterm /settings overlay
    setting_catalog.rs     # SettingItem catalog + fuzzy filter + apply effects
    fuzzy.rs               # Pi-compatible fuzzy filter
```

CLI 不创建第二套 domain model；`CliArgs`、Console command 与 render DTO 都是壳内私有类型。

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
  → else: run Harness Console; create Agent on first ordinary message or /new
```

配置优先级：

```text
LLM（四层 merge，低 → 高）：
  catalog preset → settings.json → MOONTIDE_* + provider API key env → CLI flags

非 LLM 设置：
  explicit CLI flag > settings.json > environment > fixed default

API key（LLM merge 内字段 precedence）：
  settings.json < DEEPSEEK_API_KEY / AGNES_API_KEY < --api-key
  interactive Console 仅在四层均为空时读取隐藏 stdin（Settings Preflight）
```

LLM merge 由 `agent::llm::merge_startup_llm_config` 执行。CLI 自己拥有 settings
schema/JSON IO，把已解析 settings、环境和 flags 构造成 `LlmConfigLayer`；它不调用
agent-owned settings reader，也不直接依赖 catalog 实现。

`settings.json` 位于 `<cwd>/.moontide/settings.json`，当前 schema 为 `version: 2`（兼容读取 `version: 1`）。`CliArgs` 对可覆盖字段使用 `Option<T>`，以区分“未传入”和“显式传入”。CLI 负责 JSON schema、读取、版本校验和优先级；`agent::platform` 负责项目路径和设置文件原子替换。

`--provider` 选择 catalog 中的 `ProviderId`。merge 先确定最终 provider，再从该
provider 的 catalog default 建立 baseline；低层其他 provider 的 model/base URL/key
不会继承。环境或 flags 对最终 provider 显式给出的 model/base URL 才覆盖 baseline。

---

## 4. `CliArgs` 与配置解析

```rust
struct CliArgs {
    session: Option<String>,
    prompt: Option<String>,
    cwd: Option<PathBuf>,
    sessions_dir: Option<PathBuf>,
    runs_dir: Option<PathBuf>,
    provider: Option<ProviderArg>,
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    approval_policy: Option<ApprovalPolicyArg>,
    trace: Option<TraceModeArg>,
}

fn resolve_agent_config(args: &CliArgs, settings: &GlobalConfigStore) -> anyhow::Result<AgentConfig>;
```

解析规则：

1. `cwd` 缺省为 `current_dir()`；
2. sessions/runs 缺省为 cwd 下 `.moontide` 子目录；相对覆盖路径以 resolved cwd 为基准；
3. settings 文件缺失时 LLM 字段来自 catalog preset；非 LLM 字段使用 CLI 默认值；
4. CLI 自己把 persisted settings 转换为 `LlmConfigLayer`，再与 `read_llm_env` 和 CLI host layer 一起交给 `merge_startup_llm_config`；
5. API key precedence：同 provider settings < 最终 provider 对应 env < `--api-key`；one-shot 缺 key 直接失败；
6. `max_tokens`、`max_steps` 和 thinking level 从 settings.json 加载，缺失时使用 CLI 默认值；
7. 工具 names 与 permission map 使用 coding preset 固定值；
8. approval handler 注入交互式 stdin/stderr 实现；
9. `AgentConfig.system_prompt` 不由 CLI 拼接，agent 内部解析 Harness + Project Instructions。

interactive Settings Preflight 在 Agent create/resume 之前运行。Preflight 通过
`resolve_api_key_source` 区分 key 来自 `--api-key`、最终 provider env 或同 provider
`settings.json`；四层均为空时使用隐藏输入。显式空 `--api-key` 直接失败；显式空白
model/base URL 也在 CLI layer 构造时失败。one-shot 不进入 Settings，缺失 key 直接
返回配置错误。

`ApprovalPolicy::Always` 将所有启用工具映射为 `Ask`；`Default` 使用 coding preset；`AlwaysAllow` 将所有启用工具映射为 `Allow` 且不注入 approval handler。`AlwaysAllow` 只在 Settings 输入 `ALLOW` 后生效。策略只属于 CLI runtime settings，不新增 agent-core policy 模块。

`--trace events` 使用 `AgentProgressObserver` 展示安全语义事件；`--trace events-thinking` 额外展示 provider 返回的 Thinking。两者均输出到 stderr，不引入 OTel 或 trace/span identity。

---

## 5. Harness Console

```text
global_config_store = preflight() # settings.json is read at this lifecycle boundary
host_progress = ConsoleRenderer
if --session:
  agent = resume(global_config_store, session_id)
else:
  print latest persisted session id and resume hint
  agent = None
input_owner = global_config_store.input_owner

loop:
  line = input_owner.readline(prompt with short session id)
  if line ends with `\`: continue reading (join with newline, strip `\`)
  if line == /exit: break
  if line == /settings: crossterm overlay (agent may be None); continue
  if line == /id|/status|/sessions|/help|/thinking: print; continue
  if line == /new: create Agent; continue
  if line == /resume [id]: resume Agent; continue
  if agent is None: agent = Agent::create(global_config_store)

  token = CancellationToken::new()
  ctrl_c = tokio::signal::ctrl_c()
  select:
    result = agent.turn(line, token.clone()) → live Progress + fallback/error
    ctrl_c → token.cancel(); await turn cleanup; print cancelled
```

Console 不把 Ctrl-C 转换为新的 SessionItem；Loop 负责 cleanup 与事实配对。Turn error 打印到 stderr 后回到下一次 readline。

`/` 开头但不是已知命令的行不会进入 Agent Turn。未知 slash 打印帮助。

### 直播渲染

- interactive 与 one-shot 都装配 `ConsoleRenderer` 作为 `AgentConfig.progress`；`--trace` 经 `FanoutObserver` 叠加。
- `AssistantResponseSnapshot` 按同一 `llm_call_id` 做 prefix delta，只把新增 assistant 文本写 stdout。
- `AssistantFinalized` 对账后提交该 call 的正式文本；同 Turn 多次 finalized 依次追加。
- `ToolCall` / `ToolResult` 写 stderr，必要时先给 stdout 补换行。
- `/thinking on` 把 pending/content thinking 打到 stderr；默认关闭。这是 Console 显示开关，不等于 settings 的 thinking level。
- `Agent::turn` 返回的 `ModelResponse` 只在没有收到 finalized、或与已画文本不一致时作为 fallback。
- 不直接消费 `ModelStreamEvent`；只读 `ProgressEvent`。

### `/settings` overlay

- 命令：`/settings`；Pi 风格 hint：`Type to search · ↑↓ select · Enter/Space change · Esc cancel`
- UI：`crossterm` raw mode + alternate screen；逐键 filter（Pi fuzzy + token 分词）；↑↓ 选择
- Catalog 仅含用户向 agent 设置：model、base-url、api-key（masked）、approval-policy、trace、thinking-level、max-steps、max-tokens、cwd（只读）
- 不含 session-id、runs-dir、tools（Session 列表由 `/sessions` 负责）
- 无活动 Session 时也可以打开；`NextTurn` / `ReloadAgent` 只持久化，等到 create/resume 再生效
- 生效策略：`NextTurn`（max-* / thinking）、`ReloadAgent`（model / provider / approval / trace）、`ReadOnly`
- Provider mutation：原子刷新 Provider current、Model current/values、Base URL current
  与 runtime store，并清空旧 API key；同步只回写 mutation 后的 projection，不能让旧
  Model/Base URL entry 覆盖新 provider defaults
- 持久化：运行中的 mutation 同时更新 `GlobalConfigStore` 与 `<cwd>/.moontide/settings.json`；文件带 `version: 2`，使用 `agent::platform` 的同目录临时文件原子替换；JSON 只在 start/reload/restart 边界读取；第一版约束单 workspace 单 writer
- reload 保留 `host_progress`，避免 Settings 之后丢失直播渲染

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
- Settings、Console、approval 不允许出现第二个 stdin reader。

---

## 7. Render

Console 消费 `ProgressEvent`，不再只等最终 `ModelResponse`：

```text
ContentBlock::Text / pending Text → stdout（prefix delta）
ContentBlock::Thinking            → 默认隐藏；`/thinking on` 时 stderr
ToolCall / ToolResult             → stderr 卡片
AssistantFinalized                → 对账后提交该 call 文本
ModelResponse                     → 仅 fallback
```

`--trace` 是叠加诊断，不替代 Console 直播路径。

---

## 8. 错误与退出码

| 场景 | one-shot | Console |
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
cli → agent（含 agent::llm catalog / merge / ResolvedProviderConfig）
cli → clap / rustyline / tokio::signal / std::env

cli ↛ agent-core
cli ↛ agent-core vendor catalog（concrete catalog 只经 `agent::llm`）
cli ↛ agent-tools
cli ↛ scheduler
```

---

## 10. 单测方向

- LLM 四层 merge precedence（`agent::llm` 单测 + CLI 集成）；
- provider-scoped settings < env < CLI flags 的 model/base URL/API key 覆盖；
- Provider cycle 同时刷新完整 Model/Base URL entries 与 runtime store，并清空旧 key；
- 显式空白 model/base URL 在 layer construction 返回来源明确的错误；
- missing provider env 与 invalid path 启动失败；
- create/resume/one-shot/Console dispatch；
- `/id`、`/help`、`/exit`、`/sessions`、`/resume`、`/new`、`/thinking` 不进入 Agent Turn；
- 未知 slash 命令不作为 UserMessage；
- snapshot prefix delta 与 finalized fallback 去重；
- approval y/n/empty/EOF 映射；
- stdout 只含 assistant text，tool/approval/diagnostics 在 stderr；
- Ctrl-C 调用 token.cancel 并等待 Agent turn future cleanup；
- interactive Settings 在 create/resume 前完成 API key 与 approval policy 解析，并区分 key 来源；
- 无活动 Session 也可打开 `/settings`；
- 源码结构：CLI 持有 settings schema/IO，不调用 agent settings reader；
- Turn error 在 Console 后续输入仍可执行。
