# MoonTide

Rust 实现的 coding agent：在本地工作区跑 LLM Turn、执行工具（读/写/grep/bash 等）、持久化 Session。带 CLI；Desktop（Tauri）在开发中。

## Quick start

需要 [Rust](https://rust.rust-lang.org/) stable。首次开发建议安装 nightly rustfmt（`rustup toolchain install nightly -c rustfmt --profile minimal`）。

```sh
cargo run -p cli              # 进入 Harness Console
cargo run -p cli -- -p "..."  # one-shot
```

Provider、模型与 API key 通过 CLI settings 或环境变量配置，见 [`crates/cli/README.md`](crates/cli/README.md)。项目级 Agent 规则写在仓库根或工作区的 `AGENTS.md`。

```sh
just check    # rustfmt + clippy + workspace tests
```

## Status

当前 milestone 是 **Desktop Shell v0.1**（单窗口、单 Session、Turn 串行）。任务清单见 [`TODO.md`](TODO.md)。

| 组件 | 状态 |
|------|------|
| `agent-core`（llm / session / tools / event / model_input / context / loop） | 已实现，有测试 |
| `agent` 组合根、LLM 四轴与多协议 adapter | 已实现 |
| `cli`（Harness Console、one-shot、approval、settings） | 已实现 |
| `moontide-desktop` | Tauri bootstrap 已有；流式 UI、Session 工作台待做 |

未纳入当前范围：scheduler、多 Session 并发写入、subagent、context compaction、MCP sidecar。

## Layout

Cargo workspace，四个 crate：

```text
cli → agent → agent-core
         └── agent-tools → agent-core
```

`agent-core` 内八个模块（`llm` · `session` · `tools` · `event` · `model_input` · `context` · `loop` · `scheduler`）在同一 crate 中；`scheduler` 尚未实现。

一次 Turn：`Session Item Log` → materialize → compile → LLM；工具结果经 TurnEvent commit 回 log。Permission 为 per-tool `Allow` / `Ask` map，由 `agent` 注入、`loop` 执行。

设计与不变量：[`crates/docs/agent-core.md`](crates/docs/agent-core.md) · [`crates/agent-core/DESIGN.md`](crates/agent-core/DESIGN.md)

## Documentation

| | |
|---|---|
| 跨 crate 工程文档 | [`crates/docs/README.md`](crates/docs/README.md) |
| 工程规则 | [`AGENTS.md`](AGENTS.md) · [`crates/docs/engineering-handbook.md`](crates/docs/engineering-handbook.md) |
| 模块进度 | [`crates/agent-core/README.md`](crates/agent-core/README.md) |
| LLM provider / protocol | [`crates/docs/features/LLM-FOUR-AXIS.md`](crates/docs/features/LLM-FOUR-AXIS.md) |
| 产品计划 | [`docs/product/plan.md`](docs/product/plan.md) |
| 文档索引 | [`docs/README.md`](docs/README.md) |

TypeScript 初版快照在 [`docs/archive/`](docs/archive/)。

## Development

[`justfile`](justfile) 汇总常用检查。可选 pre-commit：`pre-commit install` 与 `pre-commit install --hook-type pre-push`（见 [`.pre-commit-config.yaml`](.pre-commit-config.yaml)）。

```sh
cargo test -p agent-core
cargo test -p agent-tools
```
