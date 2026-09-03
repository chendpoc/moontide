# MoonTide 文档

MoonTide 文档按**权威性与用途**分层。执行优先级以根 [`TODO.md`](../TODO.md) 为准；工程规则与正式术语以 [`AGENTS.md`](../AGENTS.md) 为准。

## 1. 目录结构

```text
docs/
├── README.md              # 文档入口、权威顺序与阅读路径
├── product/               # 产品方向：为什么做、面向谁、产品边界
├── spec/                  # 候选系统规格与 draft，非当前契约
├── guides/                # 操作指南：如何执行一种开发或评测工作流
├── archive/               # 历史文档，仅供追溯；入口见 archive/README.md
└── notes/                 # 分析、候选、研究与开发计划，非当前契约
    ├── runtime/           # 内核架构、多语言迁移与生态兼容
    ├── context/           # Context 架构对比
    ├── session/           # 跨 agent 会话与 artifact 交接
    ├── llm/               # Edge / local model 与路由候选
    ├── roadmap/           # 从历史 TODO 提炼的工程候选路线
    └── tool-hints/        # 工具自动记录的人工审核候选；路径由代码使用
```

| 目录 | 回答的问题 | 本地索引 |
|------|------------|----------|
| [`product/`](product/) | 产品是什么，范围和长期方向是什么？ | [`product/README.md`](product/README.md) |
| [`spec/`](spec/) | 哪些系统规格仍处于候选或 draft？ | 当前为空；历史见 [`archive/spec/`](archive/spec/) |
| [`guides/`](guides/) | 如何执行一个具体工作流？ | [`guides/README.md`](guides/README.md) |
| [`notes/`](notes/) | 哪些分析、计划或候选仍需验证？ | [`notes/README.md`](notes/README.md) |
| [`archive/`](archive/) | 哪些内容只用于历史追溯？ | [`archive/README.md`](archive/README.md) |

## 2. 权威顺序

发生冲突时，按以下顺序处理：

1. [`AGENTS.md`](../AGENTS.md)：每 turn 注入 LLM 的 runtime 硬约束；
2. [`crates/docs/engineering-handbook.md`](../crates/docs/engineering-handbook.md)：Rust 工程规则与完整判据；
3. [`crates/docs/`](../crates/docs/) 中 `design/`、`features/` 与根目录当前系统设计；
4. 对应 crate `DESIGN.md` + 模块 `README.md`：局部 API、实现和不变量；
5. [`TODO.md`](../TODO.md)：当前执行优先级与完成状态，不覆盖架构；
6. [`product/`](product/) 与 [`guides/`](guides/)：产品方向和操作流程；
7. [`spec/`](spec/) 与 [`notes/`](notes/)：候选、draft、讨论和研究；
8. [`archive/`](archive/)：历史材料，仅供追溯。

`spec` 或 `notes` 中的“定稿”“开发计划”不自动成为 Rust 当前设计。架构确认后，跨 crate 设计写入 `crates/docs/design/` 或 `features/`，模块细节写入 crate `DESIGN.md` + `src/{mod}/README.md`。

## 3. 常用阅读路径

### 新人理解项目

[`product/vision.md`](product/vision.md) → [`product/plan.md`](product/plan.md) → [`crates/docs/agent-core.md`](../crates/docs/agent-core.md) → [`crates/agent-core/README.md`](../crates/agent-core/README.md)

### 修改 Agent Core / TurnEvent

[`crates/docs/engineering-handbook.md`](../crates/docs/engineering-handbook.md) → [`crates/docs/agent-core.md`](../crates/docs/agent-core.md) → [`crates/agent-core/DESIGN.md`](../crates/agent-core/DESIGN.md) → 对应模块 [`README.md`](../crates/agent-core/README.md)

### 设计 Agent Runtime 产品 API

[`crates/docs/agent-core.md`](../crates/docs/agent-core.md) → [`notes/runtime/agent-kernel-architecture.md`](notes/runtime/agent-kernel-architecture.md) → [`notes/runtime/agent-runtime-product-direction.md`](notes/runtime/agent-runtime-product-direction.md)

### 修改 Desktop Shell

[`product/desktop-development-direction.md`](product/desktop-development-direction.md) → [`crates/moontide-desktop/DESIGN.md`](../crates/moontide-desktop/DESIGN.md) → [`crates/moontide-desktop/docs/`](../crates/moontide-desktop/docs/)

### 修改 Context / Session

[`crates/docs/agent-core.md`](../crates/docs/agent-core.md) → [`crates/agent-core/DESIGN.md#session`](../crates/agent-core/DESIGN.md#session) → [`notes/context/context-analysis.md`](notes/context/context-analysis.md)

### 修改 LLM Provider / API 适配层

[`crates/docs/features/LLM-FOUR-AXIS.md`](../crates/docs/features/LLM-FOUR-AXIS.md) → [`crates/agent-core/DESIGN.md#llm`](../crates/agent-core/DESIGN.md#llm) → [`crates/agent-core/src/llm/README.md`](../crates/agent-core/src/llm/README.md) → [`notes/llm/edge-local-models.md`](notes/llm/edge-local-models.md)

### 修改 Plugin / MCP / Sidecar

[`product/platform-strategy.md`](product/platform-strategy.md) → [`../crates/docs/candidates/extension-request-pipeline.md`](../crates/docs/candidates/extension-request-pipeline.md) · [`../crates/docs/candidates/extension-sidecar-runtime.md`](../crates/docs/candidates/extension-sidecar-runtime.md) → [`notes/runtime/runtime-multilang.md`](notes/runtime/runtime-multilang.md)

## 4. 文档归档规则

新增文档前先判断其职责：

| 内容 | 应放置位置 | 不应放置位置 |
|------|------------|--------------|
| 产品定位、用户、产品族和非目标 | `product/` | `spec/` |
| 当前 Rust 系统 owner、边界和不变量 | `crates/docs/design/`、`features/` 或根目录 `agent-core.md` | `docs/spec/` |
| 候选系统规格、未确认 schema | `spec/` | 写成当前实现承诺 |
| 可重复执行的开发或评测步骤 | `guides/` | `product/` |
| 调研、备忘、重构计划和未验证假设 | `notes/<domain>/` | 当前 Rust 文档 |
| 模块局部约定 | 对应源码目录的 `README.md` | 集中复制到 `docs/` |

命名统一使用小写 kebab-case。目录已经表达领域时，文件名不重复目录名。每份 note 必须在开头说明文档性质、状态、是否为实现承诺，并链接对应 Spec 或执行入口。

历史文档见 [`archive/`](archive/)：仅供追溯，不参与当前契约；archive 内部的交叉链接可能已失效，具体规则见 [`archive/README.md`](archive/README.md)。

## 5. 模块级文档

以下说明与 `docs/` 并列维护，因为它们直接约束对应源码模块：

| 路径 | 内容 |
|------|------|
| [`crates/agent-core/README.md`](../crates/agent-core/README.md) | 内核模块清单与推进顺序 |
| [`crates/docs/`](../crates/docs/) | Rust 工程手册、当前系统设计与明确标记的候选设计 |
| [`schema/`](../schema/) | 跨语言 wire schema 预留；仅当契约被 ≥2 种语言消费时落盘，当前为空 |
| [`services/`](../services/) | Go 后台服务预留（常驻监控 / 代理 / 调度），当前为空 |
| [`node/`](../node/) | Node 扩展生态预留（MCP / 插件），当前为空 |

其余 `crates/*` 的模块级 README 待补：新增时写在对应 crate 根，并登记到上表。

目录调整采用 clean break，不保留旧路径的转发文件。仓库内链接必须随移动同步更新。
