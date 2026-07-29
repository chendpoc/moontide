# Oculeau

一个最小可用的 coding agent harness（**TypeScript**）：loop 不变，工具 / 权限 / audit 外挂；**AgentEvent** 写入 JSONL，供 REPL 与未来 desktop sidecar 消费。

## 项目结构

```
oculeau/
├── src/
│   ├── agent/           # loop、prompt、hooks（默认策略）、tools.ts
│   ├── builtins/        # fs-tools、git-tools、askUserQuestion
│   ├── extensions/      # code-repl、context、trace 扩展
│   ├── toolkit/         # ToolDefinition、catalog、register-defaults
│   ├── permission/      # checkPermission 纯策略
│   ├── cli/             # main REPL 入口、commands、statusline
│   ├── events/          # AgentEvent bus、orchestrator、JSONL writer
│   └── context/         # context window 分析（metrics、sessions）
├── scripts/
│   ├── healthcheck/ping.ts   # LLM API smoke test（pnpm run ping）
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

Sidecar / desktop **tail 该 JSONL 文件**即可（与 Claude Code session 文件模式一致）。

## CLI

| 输出 | 内容 |
|------|------|
| **stdout** | 每轮 agent 最终 reply |
| **stderr** | statusline、prompt、分隔线；**thinking/verbose 开启时**实时 trace/context |
| **`.oculeau/events.jsonl`** | 全量结构化事件（始终写入） |

### Thinking / Verbose（调试观测，**默认关闭**）

| 模式 | stderr 展示 | 开启方式 |
|------|-------------|----------|
| **off（默认）** | 无 trace/context 噪音 | — |
| **thinking** | chalk 调用链：`▸ turn 01 💭 think` · `🔧 tool` · `✓ result`；turn banner / channel 分隔 | `/thinking on` 或 `OCULEAU_THINKING=1` |
| **verbose** | thinking + context 盒（`┌ CONTEXT · pre ┐` + token bar）+ audit/conversation `EVENT` 标记 | `/verbose on` 或 `OCULEAU_VERBOSE=1` |

`.oculeau/events.jsonl` **始终写入**；thinking/verbose 只控制 stderr 是否同步打印美化块。

```sh
/thinking on    # 看模型推理与 tool 调用链（chalk 步骤行）
/verbose on     # 完整 debug：context 盒 + audit + conversation
/thinking status
```

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
| `/thinking on\|off\|status` | 调用链 trace（thinking / tool / result） |
| `/verbose on\|off\|status` | 完整 debug trace（含 context / audit） |

### 工具

| 工具 | 作用 |
|------|------|
| `bash` / `read_file` / `write_file` / `edit_file` / `glob` / `list_dir` | 文件与 shell |
| `grep` | 代码搜索（优先 `rg`，fallback `grep`） |
| `git_status` / `git_diff` / `git_log` | 只读 git 原子操作（优先于 bash git） |
| `git_summary` | 软链接 → `code_repl` template `git_summary`（组合 status+log+diff） |
| `http_fetch` | HTTP/HTTPS 请求（需用户批准；优先于 bash curl） |
| `inspect_context` | context window 用量 |
| `code_repl` | 多 runtime 代码执行（tsx / node / python / bash）+ **命名 templates** |
| `askUserQuestion` | 结构化多选题，阻塞等待用户输入 |
| `deep_research` | 网络调研（**实验性**，默认未注册；见下方） |

权限 `ask` 类工具（如 `rm`、`http_fetch`、`deep_research`）在 REPL 会提示 `Allow tool? [y/N]`。bash 中的 `curl`/`wget`/`rg`/`grep`/`git status|diff|log` 也会触发 ask，请使用对应 native tool。

### 新增 extension tool 模板（`deep_research`）

1. 在 `src/extensions/<name>/` 添加 `types.ts`、`handler.ts`、`index.ts`（`defineXTool()`）
2. 在 [`toolkit/register-defaults.ts`](src/toolkit/register-defaults.ts) 条件注册
3. 在 [`permission/index.ts`](src/permission/index.ts) 添加规则（网络类建议 `ask`）

### code_repl templates（Tier 1）

优先使用 template + `vars`，少写 inline code；输出多为 JSON（stdout）。

| template | runtime | 用途 |
|----------|---------|------|
| `read_json` | tsx | 读 JSON 并摘要 keys + preview |
| `jsonl_tail` | tsx | JSONL 末 N 行 parse |
| `package_scripts` | tsx | package.json scripts/deps |
| `glob_stats` | tsx | 按后缀统计文件数/字节 |
| `git_summary` | bash | git status + log + diff --stat（`git_summary` tool 指向此 template） |
| `env_check` | tsx | node/python/tsx/pnpm 版本探测 |
| `json_pretty` | python | JSON 格式化（path 或 text） |
| `peek_csv` | python | CSV 列名 + 前 N 行 |

```json
{ "template": "read_json", "vars": { "path": "package.json", "max_depth": 2 } }
{ "template": "git_summary", "vars": { "log_n": 5 } }
```

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
| `OCULEAU_DEEP_RESEARCH=1` | 注册实验性 `deep_research` tool（Tavily 搜索，需用户批准） |
| `OCULEAU_TAVILY_API_KEY` | Tavily API key（可选；不设则 keyless 模式） |
| `OCULEAU_HTTP=0` | 禁用 `http_fetch` tool（默认启用且需 ask） |
| `OCULEAU_THINKING=1` | 默认开启 thinking 模式（stderr 调用链；**默认 off**） |
| `OCULEAU_VERBOSE=1` | 默认开启 verbose 模式（完整 chalk debug trace；**默认 off**） |

## 开发与质量

```sh
pnpm lint          # ESLint（src / tests / scripts）
pnpm lint:fix      # 自动修复
pnpm typecheck
pnpm test
```

Git hooks（[husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged)）：

| Hook | 行为 |
|------|------|
| **pre-commit** | 对 staged 的 `.ts` 跑 `eslint --fix`，然后全量 `typecheck` |
| **pre-push** | `pnpm test` |

`pnpm install` 会通过 `prepare` 脚本安装 hooks。

## Phase 2（计划）

Slint desktop sidecar **tail `workdir/.oculeau/events.jsonl`**，Chat + Trace 多 tab UI。
