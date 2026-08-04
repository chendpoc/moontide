# Ocula

**Ocula** — /AH-kyoo-lah/ · 最小可用的 coding agent harness（**TypeScript**）：loop 不变，工具 / 权限 / tool-use-log 外挂；每个 run 的 **AgentEvent** 写入分段 JSONL，供 REPL 与 desktop sidecar（`ui/`）消费。

当前开发优先级与非目标见 [`docs/product/plan.md`](docs/product/plan.md)。设计文档索引见 [`docs/README.md`](docs/README.md)（Doc Map）。

## 项目结构

```
ocula/
├── crates/              # Rust agent（ocula-cli、ocula-agent、session、tools…）
├── Cargo.toml           # workspace
├── docs/                # 设计 Spec 与 Doc Map（product / spec / notes）
├── src/
│   ├── main.ts          # 进程入口（REPL）
│   ├── bootstrap.ts     # env / provider 初始化
│   ├── agent/           # agent-run、loop、hooks、pipeline（runLLM / runTool）
│   ├── instruction-state/  # AGENTS.md / rules → InstructionState
│   ├── plugins/
│   │   └── builtin/     # built-in plugins：log-sync、code-repl、context、session-persistence、deep-research
│   ├── plugin-host/     # external plugins：manifest · sidecar attach · stdio IPC
│   ├── plugin-sdk/      # defineSidecarPlugin
│   ├── tools/           # registry · execute · definitions · builtins/
│   ├── session/         # Session Item Log · stores/ · paths
│   ├── context-inspect/ # 观测：metrics · format · debug emit
│   ├── llm/             # protocol · routing · models · client
│   ├── cli/             # REPL：commands、repl、statusline、session-persistence-glue
│   ├── log/             # event-hub、JSONL writer、stderr renderer
│   ├── context/         # composer/（Context Composer 专用）
│   ├── storage/         # fs 约定 · list-json
│   ├── utils/           # fs · process · glob · compress · hash · tmp · path
│   └── constants/       # storage、llm、env 等常量
├── scripts/
│   └── cursor-statusline.ts
├── tests/
├── ui/                  # Rust/Slint desktop sidecar（只读 tail JSONL）
│   ├── src/             # watcher、event store
│   └── ui/              # Slint 组件
└── package.json
```

## 快速开始

```sh
cd ocula
pnpm install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

pnpm run ping -- "say hello in one word"
pnpm dev                 # REPL：statusline + stdout 正文
pnpm dev:ui              # Slint sidecar（另开终端，或 REPL 运行时启动）
```

Sidecar 详情见 [`ui/README.md`](ui/README.md)。

## Rust CLI（R0）

Native agent loop（Session JSONL → Composer v1 → LLM → builtins）：

```sh
cargo run -p ocula-cli -- --workdir .
cargo run -p ocula-cli -- --workdir . --always-allow
# 或
cargo build -p ocula-cli --release && ./target/release/ocula
```

启动 banner：`Ocula — type /help for commands`

**REPL 命令：** `/help` · `/thinking` · `/verbose` · `/debug` · `/save` · `/resume` · `/always-allow on|off|status` · `/new`（别名 `/reset`）· `/workdir` · `/exit`（别名 `q` · `exit`）

**Observability（stderr，不影响 stdout 正文）：**

- `/thinking on` — 每 turn 打印 banner；tool / thinking / result 摘要
- `/verbose on` — 在 thinking 基础上额外打印 compose 摘要（messages · tools · truncated · artifacts）
- `/debug on|terminal|file` — **无截断全量** compose / llm_call / tool_use（terminal → stderr；file 额外落盘 `.ocula/debug/<runId>.jsonl`）
- 环境变量：`OCULA_THINKING=1` · `OCULA_VERBOSE=1`（verbose 开启时 thinking 视为开启）· `OCULA_DEBUG=1|terminal|file`

**权限：** ask 类工具（如 `bash` 含 curl、`http_fetch`）默认提示 `Allow tool? [y/N]`；`/always-allow on` 或 `--always-allow` 或 `OCULA_ALWAYS_ALLOW=1` 自动批准。

需 `.env` 中 `DEEPSEEK_API_KEY`（或 `ANTHROPIC_API_KEY`）。

TypeScript CLI（`pnpm dev`）仍作参考实现与 conformance 对照；release 方向见 [`docs/product/platform-strategy.md`](docs/product/platform-strategy.md)。

## 文档

| 层级 | 路径 | 内容 |
|------|------|------|
| 索引 | [`docs/README.md`](docs/README.md) | Doc Map、阅读路径 |
| 方向 | [`docs/product/`](docs/product/) | [vision](docs/product/vision.md)、[plan](docs/product/plan.md) |
| Spec | [`docs/spec/`](docs/spec/) | context-composer、llm-provider、llm-input、agent-events |
| 参考 | [`docs/notes/`](docs/notes/) | 行业分析、演进 backlog、runtime 讨论 |

Agent 协作用词规范见 [`agent.md`](agent.md)。

## LLM Provider 与模型配置

Ocula 采用 **API 适配方案 A**（4 协议族 × 官方 SDK + 自管 normalize）：Harness（agent loop）全自建，adapter 层负责 preset 解析与 HTTP 发包。第一版 preset 覆盖 DeepSeek、Kimi、OpenAI、Anthropic、Gemini、OpenRouter 与用户自定义 OpenAI/Anthropic 形中转（`custom`）。

设计详述见 [`docs/spec/llm-provider.md`](docs/spec/llm-provider.md)（API 适配层）与 [`docs/spec/context-composer.md`](docs/spec/context-composer.md)（Session Event Log、Context Composer）；演进特性 backlog 见 [`docs/notes/context-backlog.md`](docs/notes/context-backlog.md)；一次 LLM 调用的 `system` / `tools` / `messages` 对表见 [`docs/spec/llm-input.md`](docs/spec/llm-input.md)。

**今天（实现前）**：默认 DeepSeek + Anthropic 兼容端点，配置 `DEEPSEEK_API_KEY` 与 `MODEL_ID` 即可。目标配置面见 `.env.example` 中的 `OCULA_PROVIDER` 与各厂商 key。

## AgentEvent 架构

每次 agent run 产生结构化 `AgentEvent`，append 到 `workdir/.ocula/runs/<runId>.active.jsonl`。未压缩内容达到 5 MiB 时，旧 segment 使用 gzip level 2 无损压缩为 `<runId>-0001.jsonl.gz`；run 完成时压缩最后一个 segment。插件通过 **phase slot** 注册：

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
| **`.ocula/runs/<runId>.active.jsonl`** | 当前 run 的实时结构化事件 |
| **`.ocula/runs/<runId>-NNNN.jsonl.gz`** | 已封存的无损压缩 segments |
| **`.ocula/sessions/<sessionId>.jsonl`** | Session Item Log（每条消息 append，**exit 后仍在**） |
| **`.ocula/sessions/index.json`** | session 书签索引（exit / reset 自动 save；`/save` 显式写入） |
| **`.ocula/debug/<runId>.jsonl`** | `/debug file` 全量 compose/llm/tool（无 Agent Event 截断） |

### Session 持久化与恢复

对话正文 **实时 append** 到 Session Item Log；**exit 不丢对话**。Index 书签便于跨重启发现 session（详见 [`docs/notes/session-persistence.md`](docs/notes/session-persistence.md)）。

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
| **thinking** | chalk 调用链：`▸ turn 01 💭 think` · `🔧 tool` · `✓ result`；turn banner / channel 分隔 | `/thinking on` 或 `OCULA_THINKING=1` |
| **verbose** | thinking + context 盒（`┌ CONTEXT · pre ┐` + token bar）+ tool_use_log/conversation `EVENT` 标记（**有截断**） | `/verbose on` 或 `OCULA_VERBOSE=1` |
| **debug terminal** | 无截断全量 compose / llm_call / tool_use JSON → stderr | `/debug on` 或 `OCULA_DEBUG=1` |
| **debug file** | terminal + 同上全量写入 `.ocula/debug/<runId>.jsonl` | `/debug file` 或 `OCULA_DEBUG=file` |

run event log **始终写入**；thinking/verbose/debug 只控制 stderr（及 debug file 档）是否同步打印。Debug 与 verbose 差异见 [`docs/notes/context-inspect-debug.md`](docs/notes/context-inspect-debug.md)。

```sh
/thinking on    # 看模型推理与 tool 调用链（chalk 步骤行）
/verbose on     # 美化摘要 trace（context 盒 + tool_use_log + conversation，有截断）
/debug on       # 全量无截断 debug（compose / llm / tool → stderr）
/debug file     # 额外落盘 .ocula/debug/<runId>.jsonl
/thinking status
/debug status
```

### Statusline

```
Ocula idle · context 12.3% · turn 2
```

（无 context 报告时显示 `context —`。）

### REPL 命令

| 命令 | 作用 |
|------|------|
| `/help` | 命令列表 |
| `/reset` | 清空内存 session（auto-save 旧 session 到 index，换新 sessionId） |
| `/status` | verbose statusline + auto-compact 状态 |
| `/workdir [path]` | 查看或切换 workspace |
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

1. 在 `src/plugins/builtin/<name>/` 添加 `types.ts`、`handler.ts`、`index.ts`（`defineXTool()`）；core tool 实现放 `src/tools/builtins/`
2. 在 [`register-defaults.ts`](src/tools/register-defaults.ts) 条件注册
3. 在 [`permission/index.ts`](src/agent/pipeline/permission/index.ts) 添加规则（网络类建议 `ask`）

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
    "command": "tsx /path/to/ocula/scripts/cursor-statusline.ts"
  }
}
```

脚本合并 Cursor stdin payload 与 `.ocula/status.json`。

## 环境变量

| 变量 | 作用 |
|------|------|
| `DEEPSEEK_API_KEY` / `MODEL_ID` | LLM API（今天默认 DeepSeek Anthropic 兼容端点） |
| `OCULA_PROVIDER` | Provider preset（目标：`deepseek` \| `kimi` \| `openai` \| `anthropic` \| `gemini` \| `openrouter` \| `custom`） |
| `OCULA_CUSTOM_*` / `CUSTOM_API_KEY` | 自定义中转（`custom` preset；见 [`docs/spec/llm-provider.md`](docs/spec/llm-provider.md)） |
| `OCULA_COMPACT_KEEP_TURNS` | compact 保留最近 N 轮 user prompt（默认 3） |
| `OCULA_COMPACT_THRESHOLD` | auto compact 触发阈值 %（默认 85） |
| `OCULA_COMPACT_AUTO=1` | compose 超阈值时 prune 旧 turn（默认开启） |
| `OCULA_TOOL_INLINE_MAX` | 小输出 inline 上限（默认 8192 字节） |
| `OCULA_TOOL_ARTIFACT_MIN` | ≥ 此大小写入 Artifact Store（默认 8192） |
| `OCULA_TOOL_PREVIEW_CHARS` | log / compose preview 长度（默认 500） |
| `OCULA_TOOL_INLINE_FLOOR` | 动态 inline 预算下限（默认 500） |
| `OCULA_CONTEXT_LIMIT` | context 字符上限估算（默认 128k） |
| `OCULA_DEV_TOOL_LEARNING=1` | 注册 `record_tool_hint`，写入 `docs/notes/tool-hints/` |
| `OCULA_CODE_REPL_*` / `OCULA_PYTHON` / `OCULA_VENV` | code_repl 配置 |
| `OCULA_CODE_REPL_DISABLED=1` | 禁用 code_repl |
| `OCULA_DEEP_RESEARCH=1` | 注册实验性 `deep_research` tool（Tavily 搜索，需用户批准） |
| `OCULA_TAVILY_API_KEY` | Tavily API key（可选；不设则 keyless 模式） |
| `OCULA_HTTP=0` | 禁用 `http_fetch` tool（默认启用且需 ask） |
| `OCULA_THINKING=1` | 默认开启 thinking 模式（stderr 调用链；**默认 off**） |
| `OCULA_VERBOSE=1` | 默认开启 verbose 模式（美化摘要 trace；**默认 off**） |
| `OCULA_DEBUG=1\|terminal\|file` | 默认 debug 档：无截断全量 compose/llm/tool（terminal → stderr；file 额外落盘 `.ocula/debug/`；**默认 off**） |

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
