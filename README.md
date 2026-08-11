
**MoonTide** — 最小可用的 coding agent harness（**TypeScript**），由 **OceanSpark** 开发：loop 不变，工具 / 权限 / tool-use-log 外挂；每个 run 的 **AgentEvent** 写入分段 JSONL，供 REPL 与 desktop sidecar（`ui/`）消费。

产品品牌是 **MoonTide**，公司是 **OceanSpark**。技术标识：工作区 `.moontide/`、`MOONTIDE_*` 环境变量、`moontide-*` Rust crates；pnpm CLI 包名 `agent-cli`。

当前开发优先级与非目标见 [`docs/product/plan.md`](docs/product/plan.md)。设计文档索引见 [`docs/README.md`](docs/README.md)（Doc Map）。



## 项目结构

```
moontide/                      # pnpm workspace 根（moontide-workspace）
├── packages/agent-cli/             # CLI（REPL、terminal、log 装配）
│   └── src/
│       ├── main.ts            # REPL 入口
│       ├── cli/               # REPL commands、statusline
│       ├── log/               # stderr renderer、setup、cli-event-outputs
│       ├── terminal/ · i18n/ · errors/
│       └── config/            # UI 配置（status line、ui-settings）
├── packages/
│   ├── agent/                 # harness（AgentSession、hooks、compose）
│   ├── shared/ · llm/ · session/ · context-composer/
│   ├── log/ · tools/ · plugins-sdk/ · sidecar-host/
│   └── run-protocol/ · agent-core/
├── crates/                    # Rust agent（moontide-cli、moontide-agent …）
├── docs/
├── tests/
├── ui/                        # Slint desktop sidecar（tail JSONL）
└── package.json
```

## 快速开始

```sh
cd moontide
pnpm install
cp .env.example .env   # 仓库根目录；填入 DEEPSEEK_API_KEY

pnpm run ping -- "say hello in one word"
pnpm dev                 # REPL（cwd packages/agent-cli；自动加载根 .env，workdir 默认仓库根）
pnpm dev:ui              # Slint sidecar（另开终端，或 REPL 运行时启动）
```

`pnpm dev` 从 `packages/agent-cli` 启动，`.env` 与 `MOONTIDE_WORKDIR` 约定见 [`docs/notes/runtime/monorepo-packages.md`](docs/notes/runtime/monorepo-packages.md) §Dev 启动。规范单测：`pnpm run test:conformance`。

Sidecar 详情见 [`ui/README.md`](ui/README.md)。

## Rust CLI（R0）

Native agent loop（Session JSONL → Composer v1 → LLM → builtins）：

```sh
cargo run -p moontide-cli -- --workdir .
cargo run -p moontide-cli -- --workdir . --always-allow
# 或
cargo build -p moontide-cli --release && ./target/release/moontide
```

启动 banner：`MoonTide — type /help for commands`

**REPL 命令：** `/help` · `/thinking` · `/verbose` · `/debug` · `/save` · `/resume` · `/always-allow on|off|status` · `/new`（别名 `/reset`）· `/workdir` · `/exit`（别名 `/quit`）

**Observability（stderr，不影响 stdout 正文）：**

- `/thinking on` — 每 turn 打印 banner；tool / thinking / result 摘要
- `/verbose on` — 在 thinking 基础上额外打印 compose 摘要（messages · tools · truncated · artifacts）
- `/debug on|terminal|file` — **无截断全量** compose / llm_call / tool_use（stderr + 落盘 `.moontide/debug/<runId>.jsonl`；`file` 与 `terminal` 等价）
- 环境变量：`MOONTIDE_THINKING=1` · `MOONTIDE_VERBOSE=1`（verbose 开启时 thinking 视为开启）· `MOONTIDE_DEBUG=1|terminal|file`

**权限：** ask 类工具（如 `bash` 含 curl、`http_fetch`）默认提示 `Allow tool? [y/N]`；`MOONTIDE_ENV=dev` 或 `/always-allow on` 或 `--always-allow` 或 `MOONTIDE_ALWAYS_ALLOW=1` 自动批准（deny 规则仍生效）。

需 `.env` 中 `DEEPSEEK_API_KEY`。

TypeScript CLI（`pnpm dev`）仍作参考实现与 conformance 对照；release 方向见 [`docs/product/platform-strategy.md`](docs/product/platform-strategy.md)。

## 文档

| 层级 | 路径 | 内容 |
|------|------|------|
| 索引 | [`docs/README.md`](docs/README.md) | Doc Map、阅读路径 |
| 方向 | [`docs/product/`](docs/product/) | [vision](docs/product/vision.md)、[plan](docs/product/plan.md) |
| Spec | [`docs/spec/`](docs/spec/) | agent-core、context-composer、llm-provider、agent-events |
| Guide | [`docs/guides/`](docs/guides/) | 可重复执行的开发与评测工作流 |
| Notes | [`docs/notes/`](docs/notes/) | 按 runtime、context、session、evals、llm 分类的候选与计划 |

Agent 协作与开发规则见 [`AGENTS.md`](AGENTS.md)。

## LLM Provider 与模型配置

MoonTide 采用 **API 适配方案 A**（4 协议族 × 官方 SDK + 自管 normalize）：Harness（agent loop）全自建，adapter 层负责 preset 解析与 HTTP 发包。第一版 preset 覆盖 DeepSeek、Kimi、OpenAI、Anthropic、Gemini、OpenRouter 与用户自定义 OpenAI/Anthropic 形中转（`custom`）。

设计详述见 [`docs/spec/llm-provider.md`](docs/spec/llm-provider.md)（API 适配层）与 [`docs/spec/context-composer.md`](docs/spec/context-composer.md)（Session Event Log、Context Composer）；演进特性 backlog 见 [`docs/notes/context/context-backlog.md`](docs/notes/context/context-backlog.md)；一次 LLM 调用的 `system` / `tools` / `messages` 对表见 [`docs/spec/llm-input.md`](docs/spec/llm-input.md)。

**今天（实现）：** 产品默认 **DeepSeek** preset，agent 走 `openai-chat-completions`（fetch，零 vendor npm SDK）。配置 `DEEPSEEK_API_KEY` 与 `MODEL_ID` 即可。目标多 preset 配置面见 [`docs/spec/llm-provider.md`](docs/spec/llm-provider.md)。

## AgentEvent 架构

每次 agent run 产生结构化 `AgentEvent`，append 到 `workdir/.moontide/runs/<runId>.active.jsonl`。未压缩内容达到 5 MiB 时，旧 segment 使用 gzip level 2 无损压缩为 `<runId>-0001.jsonl.gz`；run 完成时压缩最后一个 segment。插件通过 **phase slot** 注册：

```
pre_llm:context → post_llm:trace → post_llm:context → post_tool:trace
```

| 通道 | 内容 |
|------|------|
| `conversation` | user_prompt、final |
| `trace` | thinking、tool_use、tool_result |
| `context` | metrics_pre、metrics_post、context_compact |
| `tool_use_log` | 每次 tool 调用记录（toolName、状态） |

Sidecar / desktop **tail 该 JSONL 文件**即可（与 Claude Code session 文件模式一致）。

## CLI

| 输出 | 内容 |
|------|------|
| **stdout** | 每轮 agent 最终 reply |
| **stderr** | statusline、prompt、分隔线；**thinking/verbose/debug 开启时**实时 trace/context |
| **`.moontide/runs/<runId>.active.jsonl`** | 当前 run 的实时结构化事件 |
| **`.moontide/runs/<runId>-NNNN.jsonl.gz`** | 已封存的无损压缩 segments |
| **`.moontide/sessions/<sessionId>.jsonl`** | Session Item Log（每条消息 append，**exit 后仍在**） |
| **`.moontide/sessions/index.json`** | session 书签索引（exit / reset 自动 save；`/save` 显式写入） |
| **`.moontide/debug/<runId>.jsonl`** | `/debug on` 全量 compose/llm/tool（无 Agent Event 截断） |

### Session 持久化与恢复

对话正文 **实时 append** 到 Session Item Log；**exit 不丢对话**。Index 书签便于跨重启发现 session（详见 [`docs/notes/session/session-persistence.md`](docs/notes/session/session-persistence.md)）。

| 概念 | 说明 |
|------|------|
| **Item Log** | 事实源；每条 user/assistant/tool 即时落盘 |
| **Index** | 元数据书签；`exit` / `/reset` 静默 upsert；`/save` 显式写入 |
| **Checkpoint** | 同 session 内某 turn 快照；配合 `/resume <checkpoint-id>` |
| **跨 session 恢复** | `/resume session <session-id>` 加载历史 REPL session |

启动时若有历史 session，stderr 打印：

```
Last session: 20260804-195300-a1b2c3d4 · resume with /resume session 20260804-195300-a1b2c3d4
```

### Thinking / Verbose / Debug（调试观测，**默认关闭**）

| 模式 | stderr 展示 | 开启方式 |
|------|-------------|----------|
| **off（默认）** | 无 trace/context 噪音 | — |
| **thinking** | chalk 调用链：`▸ turn 01 💭 think` · `🔧 tool` · `✓ result`；turn banner / channel 分隔 | `/thinking on` 或 `MOONTIDE_THINKING=1` |
| **verbose** | thinking + context 单行摘要 + tool_use_log/conversation `EVENT` 标记（**有截断**） | `/verbose on` 或 `MOONTIDE_VERBOSE=1` |
| **debug terminal** | 无截断全量 compose / llm_call / tool_use → stderr + `.moontide/debug/<runId>.jsonl` | `/debug on` 或 `MOONTIDE_DEBUG=1` |
| **debug file** | 与 terminal 相同（保留别名） | `/debug file` 或 `MOONTIDE_DEBUG=file` |

run event log **始终写入**；thinking/verbose/debug 只控制 stderr（及 debug file 档）是否同步打印。Debug 与 verbose 差异见 [`docs/notes/context/context-inspect-debug.md`](docs/notes/context/context-inspect-debug.md)。

```sh
/thinking on    # 看模型推理与 tool 调用链（chalk 步骤行）
/verbose on     # 美化摘要 trace（context 盒 + tool_use_log + conversation，有截断）
/debug on       # 全量无截断 debug（compose / llm / tool → stderr）
/debug on        # stderr + .moontide/debug/<runId>.jsonl
/debug file      # 与 on 相同（别名）
/thinking status
/debug status
```

### Statusline

常驻在 REPL 提示符 `MoonTide >>` 正上方一行（与提示符同属 stderr，每次输入前刷新）：

```
MoonTide · 2.2k/128k(1.7%) · turn 2 · deepseek-v4-pro · ~/code/moontide
MoonTide >>
```

（无 context 报告时显示 `—`。跑 prompt 时（非 verbose/thinking）上方额外一行 spinner + 随机文案。）

`/statusline set` 配置显示哪些段（默认 `product, context, turn, model, workdir`）。配置写入 `.moontide/config.toml` 的 `[ui.status_line]`；当前 segment 列表用 `/statusline status` 查看。

### REPL 命令

| 命令 | 作用 |
|------|------|
| `/help` | 命令列表 |
| `/reset` | 清空内存 session（auto-save 旧 session 到 index，换新 sessionId） |
| `/status` | 会话 + compact auto 状态（status line 常驻在提示符上方） |
| `/statusline [set <ids>\|reset\|preview]` | 配置 status line 字段（写入 `.moontide/config.toml`） |
| `/workdir [path]` | 查看或切换 workspace |
| `/settings lang en\|zh\|status` | UI 语言（写入 `.moontide/config.toml`；未配置时用 `MOONTIDE_LANG`） |
| `/compact` | prune 旧 tool_result（写 compaction Item，下轮 compose 编译） |
| `/compact preview` | dry-run token 估算 |
| `/compact summary` | LLM 摘要 → **CompactionSave** + compose 编译（额外 API） |
| `/compact auto on\|off` | 超阈值自动 prune（compose 内，不写 Item Log） |
| `/checkpoint [label]` | 创建 Checkpoint 快照 |
| `/checkpoint list` | 列出当前 session 的 Checkpoint |
| `/save` | 将当前 session 写入 index（输出 sessionId） |
| `/save list` | 列出已保存 / 磁盘上的 session |
| `/resume <checkpoint-id>` | 同 session 内恢复可见消息窗口 |
| `/resume session <session-id> [checkpoint-id]` | 跨 REPL 重启加载历史 session |
| `/thinking on\|off\|status` | 调用链 trace（thinking / tool / result） |
| `/verbose on\|off\|status` | 美化摘要 trace（含 context / tool_use_log，有截断） |
| `/debug on\|terminal\|file\|off\|status` | 全量无截断 compose/llm/tool（terminal → stderr；file 额外落盘） |

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

1. 在 `packages/agent/src/plugins/builtin/<name>/` 或 `packages/tools/src/builtins/` 添加实现；tool spec 遵循 §2.1
2. 在 [`packages/agent/src/tools/register-defaults.ts`](packages/agent/src/tools/register-defaults.ts) 条件注册
3. permission 随 `ToolSpec` 声明（[`permission-table.ts`](packages/tools/src/permission-table.ts)）

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

跨 prompt 对话会**保留 messages**；详见上文 [Session 持久化与恢复](#session-持久化与恢复)。

## Cursor CLI Statusline

在 `~/.cursor/cli-config.json` 中配置（路径按本机调整）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "tsx /path/to/moontide/scripts/cursor-statusline.ts"
  }
}
```

脚本合并 Cursor stdin payload 与 `.moontide/status.json`。

## 环境变量

| 变量 | 作用 |
|------|------|
| `DEEPSEEK_API_KEY` / `MODEL_ID` | LLM API（今天默认 DeepSeek Anthropic 兼容端点） |
| `MOONTIDE_PROVIDER` | Provider preset（目标：`deepseek` \| `kimi` \| `openai` \| `anthropic` \| `gemini` \| `openrouter` \| `custom`） |
| `MOONTIDE_CUSTOM_*` / `CUSTOM_API_KEY` | 自定义中转（`custom` preset；见 [`docs/spec/llm-provider.md`](docs/spec/llm-provider.md)） |
| `MOONTIDE_COMPACT_KEEP_TURNS` | compact 保留最近 N 轮 user prompt（默认 3） |
| `MOONTIDE_COMPACT_THRESHOLD` | auto compact 触发阈值 %（默认 85） |
| `MOONTIDE_COMPACT_AUTO=1` | compose 超阈值时 prune 旧 turn（默认开启） |
| `MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES` | ≥ 此大小 spill 到 Artifact Store（默认 8192 字节） |
| `MOONTIDE_TOOL_PREVIEW_CHARS` | spill 后 preview 长度（默认 spill 阈值 × 20% ≈ 1638；可单独覆盖） |
| `MOONTIDE_TOOL_ARTIFACT_MIN` | Rust compose 侧 spill 阈值（默认 8192，与上项对齐） |
| `MOONTIDE_TOOL_INLINE_MAX` | 小输出 inline 上限（默认 8192 字节） |
| `MOONTIDE_TOOL_INLINE_FLOOR` | 动态 inline 预算下限（默认 500） |
| `MOONTIDE_CONTEXT_LIMIT` | context 字符上限估算（默认 128k） |
| `MOONTIDE_ENV` | 运行环境：`dev` 本地开发（默认 always-allow）；`production` 或未设（默认需确认 ask 类工具） |
| `MOONTIDE_ALWAYS_ALLOW` | 显式覆盖 always-allow：`1`/`on` 开 · `0`/`off` 关（优先于 `MOONTIDE_ENV` 预设） |
| `MOONTIDE_DEV_TOOL_LEARNING=1` | 注册 `record_tool_hint`，写入 `docs/notes/tool-hints/` |
| `MOONTIDE_CODE_REPL_*` / `MOONTIDE_PYTHON` / `MOONTIDE_VENV` | code_repl 配置 |
| `MOONTIDE_CODE_REPL_DISABLED=1` | 禁用 code_repl |
| `MOONTIDE_DEEP_RESEARCH=1` | 注册实验性 `deep_research` tool（Tavily 搜索，需用户批准） |
| `MOONTIDE_TAVILY_API_KEY` | Tavily API key（可选；不设则 keyless 模式） |
| `MOONTIDE_HTTP=0` | 禁用 `http_fetch` tool（默认启用且需 ask） |
| `MOONTIDE_THINKING=1` | 默认开启 thinking 模式（stderr 调用链；**默认 off**） |
| `MOONTIDE_VERBOSE=1` | 默认开启 verbose 模式（美化摘要 trace；**默认 off**） |
| `MOONTIDE_TRACE_PREVIEW_CHARS` | thinking trace 单行 preview 长度（默认 80；原硬编码 40） |
| `MOONTIDE_DEBUG=1\|terminal\|file` | 默认 debug 档：无截断全量 compose/llm/tool（stderr + `.moontide/debug/`；**默认 off**） |

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

## Desktop UI（Slint sidecar）

只读桌面 UI 位于 [`ui/`](ui/)：根据 `status.json.runId` tail 当前 `<runId>.active.jsonl`，展示 Trace / Chat / Context 多 tab。UI 不读取 gzip 历史；与 REPL 通过文件 sidecar 通信，无 IPC。

```sh
pnpm dev      # Terminal 1
pnpm dev:ui   # Terminal 2
```

事件 schema：[`docs/spec/agent-events.md`](docs/spec/agent-events.md)。
