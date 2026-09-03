# cli

> **性质：** MoonTide 用户入口的纯壳。
> **状态：** Harness Console 已落地：直播 Progress 渲染、Session 命令、无 Session 也可打开 Settings。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。
> **关联：** [`../agent/README.md`](../agent/README.md) · [`../agent-core/src/loop/README.md`](../agent-core/src/loop/README.md)

---

## 这是什么

`cli` 负责参数、环境变量、Harness Console、approval 交互和 stdout/stderr；所有 Agent 业务状态由 `agent` 持有。

```text
CLI args + env
      ↓
interactive Settings Preflight（Console）/ non-interactive validation（one-shot）
      ↓
GlobalConfigStore → AgentConfig（始终装配 Console ProgressObserver）
      ↓
Agent::create/resume（或延后到第一条普通消息 / `/new` / `/resume`）
      ↓
one-shot prompt 或 Harness Console
      ↓
Agent::turn
      ↓
Progress → 直播 assistant/tool；终态 ModelResponse 仅作 fallback
```

用户命令名为 `moontide`，Cargo package 初版命名为 `cli`。

---

## 启动方式

```powershell
# 进入 Harness Console；第一条普通消息时才创建新 Session
cargo run -p cli

# 创建新 Session 执行一次输入
cargo run -p cli -- --prompt "请检查当前项目结构"

# 恢复已有 Session 并进入 Console
cargo run -p cli -- --session <session_id>

# 在已有 Session 上执行一次输入
cargo run -p cli -- --session <session_id> --prompt "继续刚才的任务"
```

### 参数

| 参数 | 默认 | 语义 |
|------|------|------|
| `--session <id>` | 不指定 | resume 指定 Session；未指定时先展示最近 Session，不在启动时创建 |
| `--prompt <text>` | Console | one-shot 输入 |
| `--cwd <path>` | 当前目录 | Agent 工作目录与 Project Instructions 根 |
| `--sessions-dir <path>` | `<cwd>/.moontide/sessions` | Session Item Log 目录 |
| `--runs-dir <path>` | `<cwd>/.moontide/runs` | Agent Event 目录 |
| `--provider <deepseek\|agnes>` | settings 或 `deepseek` | provider（catalog `ProviderId`） |
| `--api-key <key>` | settings/env | provider API key；显式参数优先 |
| `--model <name>` | settings 或 preset 默认 | model name |
| `--base-url <url>` | settings 或 preset 默认 | OpenAI-compatible endpoint root |
| `--approval-policy <default\|always\|always-allow>` | settings 或 `always` | one-shot approval policy；interactive Console 可在 Settings 中调整 |
| `--trace <off\|events\|events-thinking>` | settings 或 `off` | 将额外的生命周期 trace 输出到 stderr |

项目设置文件为 `<cwd>/.moontide/settings.json`，当前 schema 为 `version: 2`（含 `provider` 字段；version 1 缺省迁移为 `deepseek`）。它只在 CLI 启动时读取；reload/restart 也从该文件重新建立 `GlobalConfigStore`。运行期间的 `/settings` 同时更新内存中的 `GlobalConfigStore` 和持久化快照，不把 JSON 当作 live source。

API key 优先级为 `--api-key` > 最终 provider 对应环境变量（`DEEPSEEK_API_KEY` /
`AGNES_API_KEY`）> 同 provider 的 `settings.json` > interactive input；跨 provider 的
旧 credential/base URL/model 不继承。显式空白 model/base URL 在 CLI layer 构造时
直接失败。Agnes 集成与 catalog 分层见
[`../docs/design/agnes-provider-integration.md`](../docs/design/agnes-provider-integration.md)。

Harness Console 启动时先进入 Settings Preflight：CLI 或环境中存在 API key 时跳过输入，设置文件中存在时直接加载，否则使用隐藏输入；用户确认 Settings 后只加载最近 Session 的 id，不立即创建新 Session。无 `--session` 时，第一条普通文本或 `/new` 才触发 `Agent::create`；`/exit`、`/id`、`/settings`、`/status`、`/sessions`、`/help` 和 `/thinking` 不创建 Session。显式 `--session` 仍在启动时 resume。API key 不写入 Session 或 Agent Event。

启动时若存在历史 Session，会显示其 id 和 `moontide --session <id>` 恢复命令；Console 结束时会再次显示当前 Session 的恢复命令。无活动 Session 直接 `/exit` 时不打印恢复命令。

`always` 会把所有启用工具映射为 `Ask`；`default` 保持 coding preset 的 read/find/grep Allow 与 write/edit/bash Ask；`always-allow` 把所有启用工具映射为 `Allow` 并跳过 approval。interactive Settings 对 `always-allow` 要求输入 `ALLOW` 确认。one-shot 不进入 Settings 页面，缺失 API key 直接失败。

Trace 模式分层：`events` 展示 Turn/Step/LLM/Tool/Result 生命周期；`events-thinking` 额外展示 provider 实际返回的 Thinking block。trace 输出是 CLI 诊断，叠加在 Console 直播渲染之上，不进入 assistant stdout、Session Item Log 或 OTel。

---

## Console 命令

| 输入 | 行为 |
|------|------|
| 普通文本 | 执行一个 Agent Turn |
| 行末 `\` | 继续下一行，提交时去掉续行符并保留换行 |
| `/settings` | 打开 settings overlay；无活动 Session 也可打开，变更在下次 create/resume 生效 |
| `/status` | 打印 session、model、cwd、approval、trace 与 thinking 显示状态 |
| `/id` | 打印当前 session id；尚未创建时提示无活动 Session |
| `/sessions` | 列出已持久化 Session，当前活动项标 `*` |
| `/resume [id]` | 切换到指定 Session；省略 id 时恢复最近 Session |
| `/new` | 创建新 Session |
| `/thinking [on\|off]` | 控制 Console 是否把模型 thinking 打到 stderr；省略参数则切换 |
| `/help` | 打印命令帮助 |
| `/exit` | 退出 Console |
| Ctrl-C | 取消当前 Turn，保留已提交事实并继续 Console |

不支持多 Session 并行写入和自定义工具参数。

`/settings` 切换 Provider 时会在同一次 mutation 中刷新 Model 的 current/values、
Base URL current 和 runtime store，并清空旧 API key；旧 projection 不会在同步阶段
覆盖新 provider defaults。

---

## 输出边界

- assistant 文本（直播 snapshot / finalized，或无 Progress 时的 ModelResponse fallback）→ stdout；
- tool 卡片、thinking、session 提示、approval prompt、diagnostics → stderr；
- one-shot Turn error → stderr + non-zero exit；
- Console Turn error → stderr，Console 继续；
- Progress worker error、dropped event 或 resync requirement → stderr；
- Tool approval prompt 显示工具名、结构化参数摘要和 `y/N`；
- CLI 不 tail Agent Event JSONL；直播 UI 只消费 `agent::ProgressEvent`。

---

## 与 agent 的接缝

CLI 只做：

```text
parse → resolve config → latest-session lookup or create/resume Agent → turn → Progress render
```

CLI 不直接 import `agent-core::session`、`event`、`tools`、`loop` 或 `agent-tools`。
Settings、Console 与 approval 共享一个 InputOwner；approval handler 不直接读取 stdin。
