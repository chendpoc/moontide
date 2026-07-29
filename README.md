# Oculeau

一个最小可用的 coding agent harness（**TypeScript**）：loop 不变，工具 / 权限 / hooks 外挂；**AgentEvent** 总线供 CLI 与未来 Slint desktop 共用。

## 项目结构

```
oculeau/
├── src/
│   ├── cli/statusline/  # REPL statusline + .oculeau/status.json
│   ├── events/          # AgentEvent bus、orchestrator、CliSink、JsonlSink
│   ├── plugins/         # context / trace 插件（注册 phase slot）
│   ├── context/         # context window 分析（metrics、inspect_context）
│   ├── loop.ts          # agent loop（只调 runPhase）
│   ├── tools/           # bash / fs / code_repl / askUserQuestion 等
│   ├── hooks.ts         # 权限 + audit
│   └── main.ts          # CLI REPL
├── scripts/
│   └── cursor-statusline.ts
├── tests/
└── package.json
```

## 快速开始

```sh
cd oculeau
pnpm install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

pnpm run ping -- "say hello in one word"
pnpm dev                 # 默认：statusline + stdout 正文（stderr 无 observability 块）
pnpm dev -- --events     # 额外 stdout NDJSON events（供 sidecar / desktop）
```

## AgentEvent 架构

每次 agent run 产生结构化 `AgentEvent`，写入 `.oculeau/events.jsonl`。插件通过 **phase slot** 注册，顺序由 orchestrator 保证：

```
pre_llm:context → post_llm:trace → post_llm:context → post_tool:trace
```

| 通道 | 内容 |
|------|------|
| `conversation` | user_prompt、final |
| `trace` | thinking、tool_use、tool_result |
| `context` | metrics_pre、metrics_post、context_compact |
| `audit` | tool 审计（jsonl 始终记录） |

## CLI 模式

| 模式 | 行为 |
|------|------|
| 默认 | 持久 REPL session；compact statusline；stderr 无 observability 块；stdout 最终 reply |
| `--events` / `OCULEAU_EVENTS=1` | **额外** stdout NDJSON（含 `conversation/final`） |

### Statusline

每轮 `Oculeau >>` 前显示**一行** compact statusline（变化时才重绘）：

```
Oculeau idle · context off · trace off · stream off · display off · turn —
```

（有 context 用量时会显示 `context off (12.3%)`；`/context on` 等命令切换通道。）

`/status` 显示 verbose 详情（model、workdir、通道 ON/OFF）。

### REPL 命令

| 命令 | 作用 |
|------|------|
| `/help` | 命令列表 |
| `/reset` | 清空 session（messages + metrics） |
| `/status` | verbose statusline + auto-compact 状态 |
| `/workdir [path]` | 查看或切换 workspace |
| `/compact` | prune 旧 tool_result（7a） |
| `/compact preview` | dry-run token 估算 |
| `/compact summary` | LLM 摘要压缩（7b，额外 API） |
| `/compact auto on\|off` | 超阈值自动 prune（7c） |
| `/context\|/trace\|/events\|/events-display on\|off` | 显示/stream 开关 |

### 工具

| 工具 | 作用 |
|------|------|
| `bash` / `read_file` / `write_file` / `edit_file` / `glob` | 文件与 shell |
| `inspect_context` | context window 用量 |
| `code_repl` | 多 runtime 代码执行（tsx / node / python，可扩展） |
| `askUserQuestion` | 结构化多选题，阻塞等待用户输入 |

**code_repl runtime 选型：**

| 场景 | runtime |
|------|---------|
| TypeScript / Oculeau 脚本 | `tsx`（默认） |
| ML / 训练脚本 | `python` |
| 已有 `.js` 文件 | `node` |
| shell 管道 | `bash` |

权限 `ask` 类工具（如 `rm`）在 REPL 会提示 `Allow tool? [y/N]`。

跨 prompt 对话会**保留 messages**；`/reset` 开始新会话。

JSONL / NDJSON 每行事件含可选 `summary`、`displayHint` 字段，便于 grep，不影响机器解析。

## Cursor CLI Statusline

在 `~/.cursor/cli-config.json` 中配置（路径按本机调整）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "tsx /path/to/oculeau/scripts/cursor-statusline.ts"
  }
}
```

脚本合并 Cursor stdin payload（model、context_window%）与 `.oculeau/status.json` 中的 Oculeau 通道开关。

## 环境变量

| 变量 | 作用 |
|------|------|
| `OCULEAU_CONTEXT_DISPLAY=1` | stderr context 盒式输出（**显示开关**） |
| `OCULEAU_CONTEXT_VERBOSE=1\|2` | display ON 时的详略（breakdown 等） |
| `OCULEAU_CONTEXT_VERBOSE_DETAIL=1` | tool_result 多行展开 |
| `OCULEAU_TRACE=1` | stderr trace 时间线 |
| `OCULEAU_EVENTS_DISPLAY=1` | stderr EVENT 行 |
| `OCULEAU_EVENTS=1` | stdout NDJSON event stream |
| `OCULEAU_EVENTS_LOG` | events jsonl 路径（默认 `.oculeau/events.jsonl`） |
| `OCULEAU_CONTEXT_LOG` | context 报告 jsonl（仍双写） |
| `OCULEAU_COMPACT_KEEP_TURNS` | compact 保留最近 N 轮 user prompt（默认 3） |
| `OCULEAU_COMPACT_THRESHOLD` | auto compact 触发阈值 %（默认 85） |
| `OCULEAU_COMPACT_AUTO=1` | 默认开启 auto compact |
| `OCULEAU_CODE_REPL_DEFAULT_RUNTIME` | code_repl 缺省 runtime（默认 `tsx`） |
| `OCULEAU_CODE_REPL_TIMEOUT_MS` | code_repl 默认超时 ms（默认 120000） |
| `OCULEAU_PYTHON` | Python 解释器路径 |
| `OCULEAU_VENV` | venv 目录（prepend bin 到 PATH） |
| `OCULEAU_CODE_REPL_DISABLED=1` | 禁用 code_repl 工具 |

## 测试

```sh
pnpm test
pnpm typecheck
```

## Phase 2（计划）

Slint desktop sidecar 读取 `pnpm dev -- --events` 的 NDJSON，Chat + Trace 多 tab UI。
