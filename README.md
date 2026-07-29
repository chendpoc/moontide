# Oculeau

一个最小可用的 coding agent harness（**TypeScript**）：loop 不变，工具 / 权限 / hooks 外挂；**AgentEvent** 写入 JSONL，供 REPL 与未来 desktop sidecar 消费。

## 项目结构

```
oculeau/
├── src/
│   ├── agent/           # loop、ToolCatalog 入口（tools.ts）
│   ├── builtins/        # bash / fs / askUserQuestion 核心 tool
│   ├── extensions/      # code-repl、context、trace 扩展
│   ├── toolkit/         # ToolDefinition、createToolCatalog
│   ├── permission/      # checkPermission 单入口
│   ├── register-defaults.ts  # 显式组装 tool catalog
│   ├── cli/             # REPL、commands、statusline
│   ├── events/          # AgentEvent bus、orchestrator、JsonlSink
│   ├── context/         # context window 分析（metrics、sessions）
│   ├── hooks.ts         # audit hooks
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
pnpm dev                 # REPL：statusline + stdout 正文
```

## AgentEvent 架构

每次 agent run 产生结构化 `AgentEvent`，**始终 append** 到 `workdir/.oculeau/events.jsonl`。插件通过 **phase slot** 注册：

```
pre_llm:context → post_llm:trace → post_llm:context → post_tool:trace
```

| 通道 | 内容 |
|------|------|
| `conversation` | user_prompt、final |
| `trace` | thinking、tool_use、tool_result |
| `context` | metrics_pre、metrics_post、context_compact |
| `audit` | tool 审计 |

Sidecar / desktop **tail 该 JSONL 文件**即可（与 Claude Code session 文件模式一致）。stderr 盒式 observability 暂未接入，需要时再启用 `CliSink`。

## CLI

| 输出 | 内容 |
|------|------|
| **stdout** | 每轮 agent 最终 reply |
| **stderr** | statusline、prompt、分隔线 |
| **`.oculeau/events.jsonl`** | 全量结构化事件（机器消费） |

### Statusline

```
Oculeau idle · context 12.3% · turn 2
```

（无 context 报告时显示 `context —`。）

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

### 工具

| 工具 | 作用 |
|------|------|
| `bash` / `read_file` / `write_file` / `edit_file` / `glob` | 文件与 shell |
| `inspect_context` | context window 用量 |
| `code_repl` | 多 runtime 代码执行（tsx / node / python，可扩展） |
| `askUserQuestion` | 结构化多选题，阻塞等待用户输入 |
| `deep_research` | 网络调研（**实验性**，默认未注册；见下方） |

权限 `ask` 类工具（如 `rm`、`deep_research`）在 REPL 会提示 `Allow tool? [y/N]`。

### 新增 extension tool 模板（`deep_research`）

1. 在 `src/extensions/<name>/` 添加 `types.ts`、`handler.ts`、`index.ts`（`defineXTool()`）
2. 在 [`register-defaults.ts`](src/register-defaults.ts) 条件注册
3. 在 [`permission/index.ts`](src/permission/index.ts) 添加规则（网络类建议 `ask`）

跨 prompt 对话会**保留 messages**；`/reset` 开始新会话。

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

脚本合并 Cursor stdin payload 与 `.oculeau/status.json`。

## 环境变量

| 变量 | 作用 |
|------|------|
| `OCULEAU_EVENTS_LOG` | events jsonl 路径（默认 `.oculeau/events.jsonl`） |
| `OCULEAU_CONTEXT_LOG` | context 报告 jsonl |
| `OCULEAU_COMPACT_KEEP_TURNS` | compact 保留最近 N 轮 user prompt（默认 3） |
| `OCULEAU_COMPACT_THRESHOLD` | auto compact 触发阈值 %（默认 85） |
| `OCULEAU_COMPACT_AUTO=1` | 默认开启 auto compact |
| `OCULEAU_CODE_REPL_*` / `OCULEAU_PYTHON` / `OCULEAU_VENV` | code_repl 配置 |
| `OCULEAU_CODE_REPL_DISABLED=1` | 禁用 code_repl |
| `OCULEAU_DEEP_RESEARCH=1` | 注册实验性 `deep_research` tool |

## 测试

```sh
pnpm test
pnpm typecheck
```

## Phase 2（计划）

Slint desktop sidecar **tail `workdir/.oculeau/events.jsonl`**，Chat + Trace 多 tab UI。
