
**MoonTide** — 最小可用的 coding agent，由 **OceanSpark** 开发。

产品品牌是 **MoonTide**，公司是 **OceanSpark**。技术标识：工作区 `.moontide/`、`MOONTIDE_*` 环境变量。

Rust 内核架构以 [`docs/notes/runtime/agent-kernel-architecture.md`](docs/notes/runtime/agent-kernel-architecture.md) 为准（薄内核、MVP 四 crate、模块清单与决策清单）。产品方向见 [`docs/product/plan.md`](docs/product/plan.md)；文档索引见 [`docs/README.md`](docs/README.md)。TypeScript 初版已删除，快照在 `main`，文档在 [`docs/archive/`](docs/archive/)。

## 当前焦点

正在重建内核 crate [`crates/agent-core`](crates/agent-core/README.md)，按依赖顺序逐模块推进。

**当前模块：`tools`** — `ToolSpec` + frozen registry + 单次校验/执行/结果规范化。设计见 [`crates/agent-core/src/tools/README.md`](crates/agent-core/src/tools/README.md)。`llm`、`session` 和 `event` 已完成当前分期；初版 draft crate 已删除，不 import、不复用。

## 目标架构（Rust）

MVP 四 crate（详见架构笔记 §6–§8、§10）：

```text
cli（纯壳，只消费 AgentEvent）
  → agent-core（引擎：8 个内部 mod，不拆 crate）
  ← agent-tools（第一方 catalog/builtins）；→ agent（组合根）
```

`agent-tools` 单向依赖 `agent-core`；`agent` 同时依赖二者，`agent-core` 不反向依赖 `cli` / `agent` / `agent-tools`。`protocol` 先作 core 内类型，跨进程落地后再拆 crate。trait 按真实边界使用：`LLMProvider` / `ToolExecutor` 是核心能力端口，event pipeline 等独立实现边界也可使用窄 trait；禁止为未来可能性提前抽象。

```text
agent-core/
  llm/          # LLMProvider + protocol + adapter/normalize
  session/      # item log 唯一写者
  tools/        # ToolSpec + 单次调用边界
  event/        # RunEvent bus
  prompt/       # compile 唯一出口
  context/      # materialize + compaction
  loop/         # turn 状态机 + ToolPermissionMap 查表
  scheduler/    # 后置：分诊 / fan-out / delegate
```

Permission 当前不是独立模块：`agent` 组合根声明 `tool_name → Allow | Ask` map，`loop` 查表并处理 `Ask`，缺失项安全拒绝。

推进顺序与 checklist：[`crates/agent-core/README.md`](crates/agent-core/README.md)。

后置：本地模型 daemon、多 agent、Slint 桌面壳、Go 后台服务。卖点是隐私 / 离线 / 确定性，不打并行。

## 项目结构

```
moontide/
├── crates/
│   └── agent-core/             # 内核（当前主轨）
├── docs/
│   ├── spec/                   # 当前契约
│   └── notes/runtime/          # 内核架构与迁移
├── Cargo.toml
└── justfile
```

## 开发

```sh
just check                      # fmt + clippy + workspace test
cargo test -p agent-core
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
