
**MoonTide** — 最小可用的 coding agent，由 **OceanSpark** 开发。

产品品牌是 **MoonTide**，公司是 **OceanSpark**。技术标识：工作区 `.moontide/`、`MOONTIDE_*` 环境变量。

Rust 内核架构以 [`crates/docs/agent-core.md`](crates/docs/agent-core.md) 为准（薄内核、MVP 四 crate、模块清单与边界）；工程规则见 [`crates/docs/engineering-handbook.md`](crates/docs/engineering-handbook.md)。产品方向见 [`docs/product/plan.md`](docs/product/plan.md)；TypeScript 初版文档在 [`docs/archive/`](docs/archive/)。

## 当前焦点

`agent-core` 当前 R1 主干已基本完成，工程进入 Desktop Shell 宿主能力建设阶段。

**当前阶段：Desktop Shell v0.1** — `agent-core` 模块 1–7 主干与 `agent`/CLI 宿主基线已完成；下一步实现单窗口、单活跃 Session、Turn 串行的 Desktop Shell，优先补齐流式 UI、宿主事件、approval、取消清理与 Session 恢复；scheduler、多 Session 并发和多 Agent 后置。

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

后置：本地模型 daemon、多 agent、Go 后台服务。Desktop 当前采用 Tauri + 轻量 Web 前端；卖点是隐私 / 离线 / 确定性，不打并行。

## 项目结构

```
moontide/
├── crates/
│   ├── agent-core/             # 内核运行时契约
│   ├── agent-tools/            # 第一方 catalog 与 builtin
│   ├── agent/                   # 组合根
│   ├── cli/                     # 用户入口纯壳
│   └── docs/                   # Rust 工程手册与系统设计
├── docs/
│   ├── product/                # 产品方向与当前 Desktop 路线
│   ├── spec/                   # 候选系统规格与 draft
│   ├── guides/                 # 可重复执行的工作流
│   ├── notes/                  # 调研与候选设计
│   └── archive/                # 历史文档，仅供追溯
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
| Agent 组合根 | [`crates/agent/README.md`](crates/agent/README.md) · [`crates/agent/DESIGN.md`](crates/agent/DESIGN.md) | provider/session/tools/prompt/loop 装配 |
| CLI 纯壳 | [`crates/cli/README.md`](crates/cli/README.md) · [`crates/cli/DESIGN.md`](crates/cli/DESIGN.md) | one-shot/REPL/approval/render |
| 索引 | [`docs/README.md`](docs/README.md) | Doc Map |
| 方向 | [`docs/product/`](docs/product/) | vision / plan / Desktop development direction |
| Spec | [`docs/spec/`](docs/spec/) | 候选系统规格（当前为空）；历史见 [`docs/archive/spec/`](docs/archive/spec/) |
| Archive | [`docs/archive/`](docs/archive/) | TypeScript 时代文档 |
