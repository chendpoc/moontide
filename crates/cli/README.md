# cli

> **性质：** MoonTide 用户入口的纯壳。
> **状态：** CLI R1（crate scaffold、配置解析、one-shot）已实现并通过测试；R2/R3 待实现。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。
> **关联：** [`../agent/README.md`](../agent/README.md) · [`../agent-core/src/loop/README.md`](../agent-core/src/loop/README.md)

---

## 这是什么

`cli` 负责参数、环境变量、REPL、approval 交互和 stdout/stderr；所有 Agent 业务状态由 `agent` 持有。

```text
CLI args + env
      ↓
resolve AgentConfig
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

API key 初版从 `DEEPSEEK_API_KEY` 读取。CLI 解析后传入 `AgentConfig`，agent 不读取环境变量。

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
