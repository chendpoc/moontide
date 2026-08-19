# cli

> **性质：** MoonTide 用户入口的纯壳。
> **状态：** CLI R1/R2/R3/R4 与 R5 项目设置持久化已实现并通过 workspace 检查。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。
> **关联：** [`../agent/README.md`](../agent/README.md) · [`../agent-core/src/loop/README.md`](../agent-core/src/loop/README.md)

---

## 这是什么

`cli` 负责参数、环境变量、REPL、approval 交互和 stdout/stderr；所有 Agent 业务状态由 `agent` 持有。

```text
CLI args + env
      ↓
interactive Settings Preflight（REPL）/ non-interactive validation（one-shot）
      ↓
GlobalConfigStore → AgentConfig
      ↓
Agent::create/resume
      ↓
one-shot prompt 或 REPL
      ↓
Agent::turn
      ↓
render final ModelResponse
```

用户命令名为 `moontide`，Cargo package 初版命名为 `cli`。

---

## 启动方式

```powershell
# 查看最近 Session 并进入 REPL；第一条普通消息时才创建新 Session
cargo run -p cli

# 创建新 Session 执行一次输入
cargo run -p cli -- --prompt "请检查当前项目结构"

# 恢复已有 Session 并进入 REPL
cargo run -p cli -- --session <session_id>

# 在已有 Session 上执行一次输入
cargo run -p cli -- --session <session_id> --prompt "继续刚才的任务"
```

### 参数

| 参数 | 默认 | 语义 |
|------|------|------|
| `--session <id>` | 不指定 | resume 指定 Session；未指定时先展示最近 Session，不在启动时创建 |
| `--prompt <text>` | REPL | one-shot 输入 |
| `--cwd <path>` | 当前目录 | Agent 工作目录与 Project Instructions 根 |
| `--sessions-dir <path>` | `<cwd>/.moontide/sessions` | Session Item Log 目录 |
| `--runs-dir <path>` | `<cwd>/.moontide/runs` | Agent Event 目录 |
| `--api-key <key>` | settings/env | provider API key；显式参数优先 |
| `--model <name>` | settings 或 `deepseek-chat` | model name |
| `--base-url <url>` | settings 或 `https://api.deepseek.com` | OpenAI-compatible endpoint root |
| `--approval-policy <default\|always\|always-allow>` | settings 或 `always` | one-shot approval policy；interactive REPL 可在 Settings 中调整 |
| `--trace <off\|events\|events-thinking>` | settings 或 `off` | 将实时 progress 事件输出到 stderr |

项目设置文件为 `<cwd>/.moontide/settings.json`，从第一版开始使用 `version: 1`。它只在 CLI 启动时读取；reload/restart 也从该文件重新建立 `GlobalConfigStore`。运行期间的 `/settings` 同时更新内存中的 `GlobalConfigStore` 和持久化快照，不把 JSON 当作 live source。

API key 优先级为 `--api-key` > `DEEPSEEK_API_KEY` > `settings.json` > interactive input；显式 API key 为空时直接失败，不回退到旧 key。CLI 解析后传入 `AgentConfig`，agent 不读取环境变量。API key 可以持久化在项目设置文件中。

interactive REPL 启动时先进入 Settings Preflight：CLI 或环境中存在 API key 时跳过输入，设置文件中存在时直接加载，否则使用隐藏输入；用户确认 Settings 后只加载最近 Session 的 id，不立即创建新 Session。无 `--session` 时，第一条普通文本才触发 `Agent::create`；`/exit`、`/id`、`/settings` 和 `/help` 不创建 Session。显式 `--session` 仍在启动时 resume。API key 不写入 Session 或 Agent Event。

启动时若存在历史 Session，会显示其 id 和 `moontide --session <id>` 恢复命令；REPL 结束时会再次显示当前 Session 的恢复命令。无活动 Session 直接 `/exit` 时不打印恢复命令。

`always` 会把所有启用工具映射为 `Ask`；`default` 保持 coding preset 的 read/find/grep Allow 与 write/edit/bash Ask；`always-allow` 把所有启用工具映射为 `Allow` 并跳过 approval。interactive Settings 对 `always-allow` 要求输入 `ALLOW` 确认。one-shot 不进入 Settings 页面，缺失 API key 直接失败。

Trace 模式分层：`events` 展示 Turn/Step/LLM/Tool/Result 生命周期；`events-thinking` 额外展示 provider 实际返回的 Thinking block。trace 输出是 CLI 诊断，不进入 assistant stdout、Session Item Log 或 OTel。

---

## REPL 命令

| 输入 | 行为 |
|------|------|
| 普通文本 | 执行一个 Agent Turn |
| `/settings` | 打开 settings overlay（逐键筛选、↑↓ 选择、Enter/Space 修改） |
| `/id` | 打印当前 session id；尚未创建时提示无活动 Session |
| `/help` | 打印命令帮助 |
| `/exit` | 退出 REPL |
| Ctrl-C | 取消当前 Turn，保留已提交事实并继续 REPL |

初版不支持 `/new`、session 切换、多 session 并行和自定义工具参数。

---

## 输出边界

- assistant final text → stdout；
- session id、approval prompt、diagnostics → stderr；
- one-shot Turn error → stderr + non-zero exit；
- REPL Turn error → stderr，REPL 继续；
- Tool approval prompt 显示工具名、结构化参数摘要和 `y/N`；
- CLI 不 tail Agent Event JSONL，不直接渲染流式 snapshot。

---

## 与 agent 的接缝

CLI 只做：

```text
parse → resolve config → latest-session lookup or create/resume Agent → turn → render
```

CLI 不直接 import `agent-core::session`、`event`、`tools`、`loop` 或 `agent-tools`。
Settings、REPL 与 approval 共享一个 InputOwner；approval handler 不直接读取 stdin。
