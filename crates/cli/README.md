# cli

> **性质：** MoonTide 用户入口的纯壳。
> **状态：** CLI R1/R2 与 R3 Settings Preflight 已实现并通过测试，等待 Review。
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
RuntimeSettings → AgentConfig
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
# 创建新 Session 并进入 REPL
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
| `--session <id>` | 新建 | resume 指定 Session |
| `--prompt <text>` | REPL | one-shot 输入 |
| `--cwd <path>` | 当前目录 | Agent 工作目录与 Project Instructions 根 |
| `--sessions-dir <path>` | `<cwd>/.moontide/sessions` | Session Item Log 目录 |
| `--runs-dir <path>` | `<cwd>/.moontide/runs` | Agent Event 目录 |
| `--model <name>` | `deepseek-chat` | model name |
| `--base-url <url>` | `https://api.deepseek.com` | OpenAI-compatible endpoint root |
| `--approval-policy <default\|always\|always-allow>` | `always` | one-shot approval policy；interactive REPL 可在 Settings 中调整 |

API key 初版从 `DEEPSEEK_API_KEY` 读取。CLI 解析后传入 `AgentConfig`，agent 不读取环境变量。

interactive REPL 启动时先进入 Settings Preflight：环境中存在 `DEEPSEEK_API_KEY` 时跳过输入，不存在时使用隐藏输入；用户确认 Settings 后才 create/resume Agent。输入的 key 只存在当前进程内存，不写 Session 或 Agent Event。

`always` 会把所有启用工具映射为 `Ask`；`default` 保持 coding preset 的 read/find/grep Allow 与 write/edit/bash Ask；`always-allow` 把所有启用工具映射为 `Allow` 并跳过 approval。interactive Settings 对 `always-allow` 要求输入 `ALLOW` 确认。one-shot 不进入 Settings 页面，缺失 API key 直接失败。

---

## REPL 命令

| 输入 | 行为 |
|------|------|
| 普通文本 | 执行一个 Agent Turn |
| `/id` | 打印当前 session id |
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
parse → resolve config → create/resume Agent → turn → render
```

CLI 不直接 import `agent-core::session`、`event`、`tools`、`loop` 或 `agent-tools`。
Settings、REPL 与 approval 共享一个 InputOwner；approval handler 不直接读取 stdin。
