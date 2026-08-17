
**MoonTide** — 最小可用的 coding agent，由 **OceanSpark** 开发。

产品品牌是 **MoonTide**，公司是 **OceanSpark**。技术标识：工作区 `.moontide/`、`MOONTIDE_*` 环境变量。

Rust 内核架构以 [`crates/docs/agent-core.md`](crates/docs/agent-core.md) 为准（薄内核、MVP 四 crate、模块清单与边界）；工程规则见 [`crates/docs/engineering-handbook.md`](crates/docs/engineering-handbook.md)。产品方向见 [`docs/product/plan.md`](docs/product/plan.md)；TypeScript 初版文档在 [`docs/archive/`](docs/archive/)。

## 当前焦点

正在重建内核 crate [`crates/agent-core`](crates/agent-core/README.md)，按依赖顺序逐模块推进。

**当前模块：`model_input`** — 设计已确认，作为 `ModelRequest` 的纯组装与唯一运行时构造出口，Rust 实现待开始。`llm`、`session`、`tools`、`event` 与 `agent-tools` 当前分期已完成；初版 draft crate 已删除，不 import、不复用。

## 目标架构（Rust）

MVP 四 crate（详见架构笔记 §6–§8、§10）：

```text
cli（纯壳，只消费 AgentEvent）→ agent（组合根）
                                  ├──► agent-core（引擎：8 个内部 mod，不拆 crate）
                                  └──► agent-tools（第一方 catalog/builtins）──► agent-core
```

`agent-tools` 单向依赖 `agent-core`；`agent` 同时依赖二者，`agent-core` 不反向依赖 `cli` / `agent` / `agent-tools`。`protocol` 先作 core 内类型，跨进程落地后再拆 crate。trait 按真实边界使用：`LLMProvider` / `ToolExecutor` 是核心能力端口，event pipeline 等独立实现边界也可使用窄 trait；禁止为未来可能性提前抽象。

```text
agent-core/
  llm/          # LLMProvider + protocol + adapter/normalize
  session/      # item log 唯一写者
  tools/        # ToolSpec + 单次调用边界
  event/        # TurnEvent bus
  model_input/  # ModelRequest 的 compile 唯一出口
  context/      # materialize + compaction
  loop/         # AgentLoop ownership + Turn/Step/Tool round + retry/cancel/permission
  scheduler/    # 后置：分诊 / fan-out / delegate
```

Permission 当前不是独立模块：`agent` 组合根声明 `tool_name → Allow | Ask` map 与 approval handler，`loop::ToolRuntime` 校验并处理 `Ask`，缺失项安全拒绝。Hook 只作 post-commit、fail-open 扩展 callback，不参与 permission 或 loop 决策。

推进顺序与 checklist：[`crates/agent-core/README.md`](crates/agent-core/README.md)。

后置：本地模型 daemon、多 agent、Slint 桌面壳、Go 后台服务。卖点是隐私 / 离线 / 确定性，不打并行。

## 项目结构

```
moontide/
├── crates/
│   ├── agent-core/             # 内核运行时契约
│   ├── agent-tools/            # 第一方 catalog 与 builtin
│   └── docs/                   # Rust 工程手册与系统设计
├── docs/
│   ├── spec/                   # 候选系统规格与 draft
│   ├── notes/                  # 调研与候选设计
│   └── archive/                # TypeScript 历史文档
├── Cargo.toml
└── justfile
```

## 开发

```sh
just check                      # fmt + clippy + workspace test
cargo test -p agent-core
cargo test -p agent-tools
```

可选 git hooks：`pre-commit install` 与 `pre-commit install --hook-type pre-push`（见 [`.pre-commit-config.yaml`](.pre-commit-config.yaml)）。commit 跑 `just pre-commit`，push 跑 `just pre-push`。

Agent 协作规则见 [`AGENTS.md`](AGENTS.md)。

## 文档

| 层级 | 路径 | 内容 |
|------|------|------|
| 架构 | [`docs/notes/runtime/agent-kernel-architecture.md`](docs/notes/runtime/agent-kernel-architecture.md) | Rust 内核收敛：crate 判据、8 模块、决策清单 |
| 内核落地 | [`crates/agent-core/README.md`](crates/agent-core/README.md) | 模块依赖顺序与 checklist |
| 索引 | [`docs/README.md`](docs/README.md) | Doc Map |
| 方向 | [`docs/product/`](docs/product/) | vision / plan |
| Spec | [`docs/spec/`](docs/spec/) | agent-core、agent-events、context-composer、llm-provider |
| Archive | [`docs/archive/`](docs/archive/) | TypeScript 时代文档 |
