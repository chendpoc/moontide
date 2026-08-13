
**MoonTide** — 最小可用的 coding agent，由 **OceanSpark** 开发。内核、推理与 CLI 用 **Rust**（Cargo workspace）；后台服务（Go）与扩展生态（Node）后置到真实需求出现时再落地。

产品品牌是 **MoonTide**，公司是 **OceanSpark**。技术标识：工作区 `.moontide/`、`MOONTIDE_*` 环境变量、`moontide-*` crates。

当前开发优先级与非目标见 [`docs/product/plan.md`](docs/product/plan.md)。设计文档索引见 [`docs/README.md`](docs/README.md)（Doc Map）。TypeScript 初版实现已删除，快照保留在 `main` 分支，文档归档在 [`docs/archive/`](docs/archive/)；迁移过程见 [`docs/notes/runtime/migration-plan.md`](docs/notes/runtime/migration-plan.md)。

## 项目结构

```
moontide/
├── crates/                     # Rust（Cargo workspace）—— 内核 + 推理 + CLI + UI
│   ├── moontide-protocol/      # LLM 协议与 Session Log 类型
│   ├── moontide-session/       # Session Event Log 读写、artifact 存储
│   ├── moontide-composer/      # Session Log → LLM 请求（prune、截断 fallback）
│   ├── moontide-llm/           # Anthropic 兼容 HTTP 客户端
│   ├── moontide-tools/         # tool 注册表、执行、权限、输出 projection
│   ├── moontide-observability/ # thinking / verbose 开关与 stderr trace
│   ├── moontide-agent/         # agent 主循环（compose → LLM → tool pipeline）
│   ├── moontide-cli/           # 终端 REPL（clap + rustyline）
│   └── moontide-ui/            # Slint desktop sidecar（只读）
├── services/                   # Go 后台监控 / 代理（预留，后置）
├── node/                       # Node 扩展生态（预留，后置）
├── schema/                     # 跨语言契约（预留）
├── docs/
├── Cargo.toml
└── justfile                    # build / test / check 编排入口
```

## 快速开始

```sh
cd moontide
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

cargo run -p moontide-cli -- --workdir .
cargo run -p moontide-cli -- --workdir . --always-allow
cargo run -p moontide-ui -- --workdir .        # Slint sidecar（另开终端）
```

装了 [`just`](https://github.com/casey/just) 后可用 `just run`、`just ui`、`just check`。release 构建：

```sh
cargo build -p moontide-cli --release && ./target/release/moontide
```

启动 banner：`MoonTide — type /help for commands`。需 `.env` 中 `DEEPSEEK_API_KEY`（或 `ANTHROPIC_API_KEY`）。

## CLI

启动参数：`--workdir <PATH>`（默认 `.`，可用 `MOONTIDE_WORKDIR`）· `--always-allow`（启动即自动批准 ask 类工具）。

### REPL 命令

| 命令 | 作用 |
|------|------|
| `/help` | 命令列表 |
| `/new`（别名 `/reset`） | 新建 session |
| `/workdir` | 打印当前 workspace |
| `/thinking on\|off\|status` | 调用链 trace（thinking · tool · result） |
| `/verbose on\|off\|status` | thinking + 每 turn compose 摘要 |
| `/always-allow on\|off\|status` | ask 类工具自动批准 |
| `/exit`（别名 `/quit`） | 退出 |

`/status`、`/compact` 尚未在 Rust 实现，`/help` 中已标注。

### 观测（stderr，不影响 stdout 正文）

| 模式 | 输出 | 开启方式 |
|------|------|----------|
| **off（默认）** | 无 trace 噪音 | — |
| **thinking** | turn banner、thinking 行、`tool →`、`✓ result` | `/thinking on` 或 `MOONTIDE_THINKING=1` |
| **verbose** | thinking + compose 摘要（messages · tools · system chars · truncated · artifacts） | `/verbose on` 或 `MOONTIDE_VERBOSE=1` |

verbose 开启时 thinking 视为开启。

### 权限

工具权限在 `moontide-tools` 的 permission 层判定：ask 类（workdir 外的文件读写、bash 中的 `rm`/`curl`/`wget`/`rg`/`grep`/`git status|diff|log` 等）在 REPL 提示 `Allow tool? [y/N]`；高危命令（`rm -rf /`、`sudo`、`mkfs`、`dd if=` 等）直接 deny。`MOONTIDE_ENV=dev`、`/always-allow on`、`--always-allow` 或 `MOONTIDE_ALWAYS_ALLOW=1` 自动批准 ask 类（deny 规则仍生效）。

bash 中的 `curl`/`wget`/`rg`/`grep`/`git status|diff|log` 会触发 ask，请改用对应 native tool。

### 工具

| 工具 | 作用 |
|------|------|
| `bash` / `read_file` / `write_file` / `edit_file` / `glob` / `list_dir` | 文件与 shell |
| `grep` | 代码搜索 |
| `git_status` / `git_diff` / `git_log` | 只读 git 原子操作（优先于 bash git） |
| `git_summary` | status + log + diff --stat 组合概览 |
| `read_artifact` | 读取 spill 到 artifact store 的 tool 输出 |
| `record_tool_hint` | 仅 `MOONTIDE_DEV_TOOL_LEARNING=1` 时注册；写入 `docs/notes/tool-hints/` |

## 落盘

| 路径 | 内容 |
|------|------|
| `.moontide/sessions/<sessionId>.jsonl` | Session Event Log；事实源，每条消息即时 append，**exit 后仍在** |
| `.moontide/artifacts/<sessionId>/art_<uuid>` | 超过阈值 spill 出去的 tool 输出 |

sessionId 格式 `YYYYMMDD-HHmmss-<8hex>`。

**尚未落地：** Agent Event JSONL（`.moontide/runs/<runId>.active.jsonl`）与 `status.json` 的写入还在 Rust 内核的待办中；`moontide-ui` 已按该契约实现消费侧。事件 schema 见 [`docs/spec/agent-events.md`](docs/spec/agent-events.md)。

## LLM Provider 与模型配置

今天默认走 **DeepSeek** 的 Anthropic 兼容端点（`https://api.deepseek.com/anthropic`），模型默认 `deepseek-v4-pro`。配置 `DEEPSEEK_API_KEY` 与 `MODEL_ID` 即可，`ANTHROPIC_BASE_URL` 可覆盖端点。

目标多 preset 配置面（DeepSeek · Kimi · OpenAI · Anthropic · Gemini · OpenRouter · custom）见 [`docs/spec/llm-provider.md`](docs/spec/llm-provider.md)；一次调用的 `system` / `tools` / `messages` 对表见 [`docs/spec/llm-input.md`](docs/spec/llm-input.md)。

## 环境变量

| 变量 | 作用 |
|------|------|
| `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | LLM API key（前者优先） |
| `ANTHROPIC_BASE_URL` | API base URL（默认 DeepSeek Anthropic 兼容端点） |
| `MODEL_ID` | 模型 ID（默认 `deepseek-v4-pro`） |
| `MOONTIDE_WORKDIR` | CLI workdir（等价 `--workdir`） |
| `MOONTIDE_ENV` | 运行环境：`dev` 本地开发（默认 always-allow）；其他值按 production |
| `MOONTIDE_ALWAYS_ALLOW` | 显式覆盖 always-allow（优先于 `MOONTIDE_ENV`） |
| `MOONTIDE_THINKING=1` | 默认开启 thinking（**默认 off**） |
| `MOONTIDE_VERBOSE=1` | 默认开启 verbose（**默认 off**） |
| `MOONTIDE_COMPACT_AUTO` | compose 超阈值时自动 prune（默认开启） |
| `MOONTIDE_COMPACT_THRESHOLD` | auto compact 触发阈值 %（默认 85） |
| `MOONTIDE_COMPACT_KEEP_TURNS` | prune 保留最近 N 轮 user turn（默认 3） |
| `MOONTIDE_CONTEXT_LIMIT` | context 字符上限估算（默认 128000） |
| `MOONTIDE_TOOL_INLINE_MAX` | tool 输出 inline 上限（默认 8192） |
| `MOONTIDE_TOOL_INLINE_FLOOR` | 动态 inline 预算下限（默认 500） |
| `MOONTIDE_TOOL_ARTIFACT_MIN` | spill 到 artifact 的字节阈值（默认 8192） |
| `MOONTIDE_TOOL_PREVIEW_CHARS` | spill 后 preview 长度（默认为 artifact 阈值的 20%） |
| `MOONTIDE_DEV_TOOL_LEARNING=1` | 注册 `record_tool_hint`，写入 `docs/notes/tool-hints/` |

## 开发与质量

```sh
cargo fmt --all
cargo clippy --workspace --all-targets
cargo test --workspace
just check          # 上面三条的组合
```

CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 push / PR 到 `main` 时跑 workspace 的 `cargo test`。仓库当前不装 git hooks。

## Desktop UI（Slint sidecar）

只读桌面 UI 位于 [`crates/moontide-ui/`](crates/moontide-ui/)：从 `.moontide/status.json` 取 `runId`，tail 对应 `.moontide/runs/<runId>.active.jsonl`，展示 Trace / Context / Chat 三个 tab，状态栏显示 phase、model、turn、context% 与 workdir。与 CLI 通过文件 sidecar 通信，无 IPC。

详情见 [`crates/moontide-ui/README.md`](crates/moontide-ui/README.md)。

## 文档

| 层级 | 路径 | 内容 |
|------|------|------|
| 索引 | [`docs/README.md`](docs/README.md) | Doc Map、阅读路径 |
| 方向 | [`docs/product/`](docs/product/) | [vision](docs/product/vision.md)、[plan](docs/product/plan.md) |
| Spec | [`docs/spec/`](docs/spec/) | agent-core、agent-events、context-composer、llm-provider、llm-input |
| Guide | [`docs/guides/`](docs/guides/) | 工程手册与可重复执行的工作流 |
| Notes | [`docs/notes/`](docs/notes/) | 内核架构、迁移计划与研究方向 |
| Archive | [`docs/archive/`](docs/archive/) | TypeScript 时代文档，仅供追溯 |

Agent 协作与开发规则见 [`AGENTS.md`](AGENTS.md)。
