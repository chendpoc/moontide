# MoonTide 文档

MoonTide 文档按**权威性与用途**分层。执行优先级以根 [`TODO.md`](../TODO.md) 为准；工程规则与正式术语以 [`AGENTS.md`](../AGENTS.md) 为准。

## 1. 目录结构

```text
docs/
├── README.md              # 文档入口、权威顺序与阅读路径
├── product/               # 产品方向：为什么做、面向谁、产品边界
├── spec/                  # 当前设计契约：系统应当如何工作
├── guides/                # 操作指南：如何执行一种开发或评测工作流
├── archive/               # TypeScript 时代的讨论与实现文档，仅供追溯
└── notes/                 # 分析、候选、研究与开发计划，非当前契约
    ├── runtime/           # 内核架构、多语言迁移与生态兼容
    ├── context/           # Context 架构对比
    ├── session/           # 跨 agent 会话与 artifact 交接
    ├── evals/             # Task taxonomy 与 Model–Harness Fit 研究
    ├── llm/               # Edge / local model 与路由候选
    └── tool-hints/        # 工具自动记录的人工审核候选；路径由代码使用
```

| 目录 | 回答的问题 | 本地索引 |
|------|------------|----------|
| [`product/`](product/) | 产品是什么，范围和长期方向是什么？ | [`product/README.md`](product/README.md) |
| [`spec/`](spec/) | 当前认可的系统契约和模块边界是什么？ | [`spec/README.md`](spec/README.md) |
| [`guides/`](guides/) | 如何执行一个具体工作流？ | [`guides/README.md`](guides/README.md) |
| [`notes/`](notes/) | 哪些分析、计划或候选仍需验证？ | [`notes/README.md`](notes/README.md) |

## 2. 权威顺序

发生冲突时，按以下顺序处理：

1. [`AGENTS.md`](../AGENTS.md)：每 turn 注入 LLM 的 runtime 规则摘要；
2. [`TODO.md`](../TODO.md)：当前执行优先级与完成状态；
3. [`spec/`](spec/)：当前认可的设计契约；
4. [`product/`](product/)：产品方向与范围；
5. [`guides/`](guides/)：基于当前实现的操作流程；
6. [`notes/`](notes/)：候选、讨论、研究和未来计划。

`notes` 中的“定稿”“开发计划”不自动覆盖 Spec，也不代表已经实现。实现完成后，应更新对应 Spec、Guide 和 TODO，而不是只修改 note。

## 3. 常用阅读路径

### 新人理解项目

[`product/vision.md`](product/vision.md) → [`product/plan.md`](product/plan.md) → [`spec/agent-core.md`](spec/agent-core.md) → [`spec/context-composer.md`](spec/context-composer.md) → [`spec/llm-provider.md`](spec/llm-provider.md)

### 执行 TypeScript → Rust 迁移

[`notes/runtime/migration-plan.md`](notes/runtime/migration-plan.md) → [`notes/runtime/agent-kernel-architecture.md`](notes/runtime/agent-kernel-architecture.md) → [`notes/runtime/runtime-multilang.md`](notes/runtime/runtime-multilang.md)

### 修改 Agent Core / RunEvent

[`spec/agent-core.md`](spec/agent-core.md) → [`notes/runtime/agent-kernel-architecture.md`](notes/runtime/agent-kernel-architecture.md) → [`spec/agent-events.md`](spec/agent-events.md)

### 设计 Agent Runtime 产品 API

[`notes/runtime/agent-kernel-architecture.md`](notes/runtime/agent-kernel-architecture.md) → [`notes/runtime/agent-runtime-product-direction.md`](notes/runtime/agent-runtime-product-direction.md) → [`spec/agent-core.md`](spec/agent-core.md)

### 修改 Context / Session

[`spec/context-composer.md`](spec/context-composer.md) → [`notes/context/context-analysis.md`](notes/context/context-analysis.md) → [`notes/session/session-handoff.md`](notes/session/session-handoff.md)

### 修改 LLM Provider / API 适配层

[`spec/llm-provider.md`](spec/llm-provider.md) → [`spec/llm-input.md`](spec/llm-input.md) → [`notes/llm/edge-local-models.md`](notes/llm/edge-local-models.md)

### 修改 Plugin / MCP / Sidecar

[`product/platform-strategy.md`](product/platform-strategy.md) → [`notes/runtime/ecosystem-compat.md`](notes/runtime/ecosystem-compat.md) → [`notes/runtime/runtime-multilang.md`](notes/runtime/runtime-multilang.md)

### 研究 Model–Harness Fit

[`notes/evals/model-harness-fit.md`](notes/evals/model-harness-fit.md) → [`notes/evals/agent-eval-task-taxonomy.md`](notes/evals/agent-eval-task-taxonomy.md) → [`notes/runtime/agent-runtime-product-direction.md`](notes/runtime/agent-runtime-product-direction.md)

## 4. 文档归档规则

新增文档前先判断其职责：

| 内容 | 应放置位置 | 不应放置位置 |
|------|------------|--------------|
| 产品定位、用户、产品族和非目标 | `product/` | `spec/` |
| 当前应然契约、schema、owner 和不变量 | `spec/` | `notes/` 长期悬置 |
| 可重复执行的开发或评测步骤 | `guides/` | `product/` |
| 调研、备忘、候选、重构计划和未验证假设 | `notes/<domain>/` | `spec/` |
| 模块局部约定 | 对应源码目录的 `README.md` | 集中复制到 `docs/` |

命名统一使用小写 kebab-case。目录已经表达领域时，文件名不重复目录名。每份 note 必须在开头说明文档性质、状态、是否为实现承诺，并链接对应 Spec 或执行入口。

TS 时代的文档见 [`archive/`](archive/)：仅供追溯，不参与当前契约，也不出现在各目录索引中；`archive/` 内部的交叉链接可能已失效。

## 5. 模块级文档

以下说明与 `docs/` 并列维护，因为它们直接约束对应源码模块：

| 路径 | 内容 |
|------|------|
| [`crates/moontide-ui/README.md`](../crates/moontide-ui/README.md) | Slint sidecar：tail 的文件、tab 与状态栏 |
| [`schema/README.md`](../schema/README.md) | 跨语言契约的落点判据 |
| [`services/README.md`](../services/README.md) | Go 后台服务边界（后置） |
| [`node/README.md`](../node/README.md) | Node 扩展生态边界（后置） |

其余 `crates/*` 的模块级 README 待补：新增时写在对应 crate 根，并登记到上表。

目录调整采用 clean break，不保留旧路径的转发文件。仓库内链接必须随移动同步更新。
