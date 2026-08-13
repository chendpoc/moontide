# MoonTide 文档

MoonTide 文档按**权威性与用途**分层。执行优先级以根 [`TODO.md`](../TODO.md) 为准；工程规则与正式术语以 [`AGENTS.md`](../AGENTS.md) 为准。

## 1. 目录结构

```text
docs/
├── README.md              # 文档入口、权威顺序与阅读路径
├── product/               # 产品方向：为什么做、面向谁、产品边界
├── spec/                  # 当前设计契约：系统应当如何工作
├── guides/                # 操作指南：如何执行一种开发或评测工作流
└── notes/                 # 分析、候选、研究与开发计划，非当前契约
    ├── runtime/           # Temporal Core、plugin、进程与工程架构
    ├── context/           # Context Composer 演进、Deep Mode 与检索
    ├── session/           # Session 事实、持久化、迁移与交接
    ├── evals/             # Harness eval、taxonomy、artifact 与研究方向
    ├── llm/               # Provider backlog、edge/local model
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
2. [`guides/engineering-handbook.md`](guides/engineering-handbook.md)：工程原则、术语与 Conformance 完整版（人类 / IDE 参考，默认不注入）；
3. [`TODO.md`](../TODO.md)：当前执行优先级与完成状态；
4. [`spec/`](spec/)：当前认可的设计契约；
5. [`product/`](product/)：产品方向与范围；
6. [`guides/`](guides/)：基于当前实现的操作流程；
7. [`notes/`](notes/)：候选、讨论、研究和未来计划。

`notes` 中的“定稿”“开发计划”不自动覆盖 Spec，也不代表已经实现。实现完成后，应更新对应 Spec、Guide 和 TODO，而不是只修改 note。

## 3. 常用阅读路径

### 新人理解项目

[`product/vision.md`](product/vision.md) → [`product/plan.md`](product/plan.md) → [`spec/agent-core.md`](spec/agent-core.md) → [`spec/context-composer.md`](spec/context-composer.md) → [`spec/llm-provider.md`](spec/llm-provider.md)

### 修改 Agent Core / RunEvent

[`spec/agent-core.md`](spec/agent-core.md) → [`notes/runtime/agent-core-roadmap.md`](notes/runtime/agent-core-roadmap.md) → [`spec/agent-events.md`](spec/agent-events.md) → [`TODO.md`](../TODO.md) §16

### 设计 Agent Runtime 产品 API

[`notes/runtime/agent-runtime-api.md`](notes/runtime/agent-runtime-api.md) → [`spec/agent-core.md`](spec/agent-core.md) → [`spec/context-composer.md`](spec/context-composer.md) → [`notes/session/session-domain-model.md`](notes/session/session-domain-model.md)

### 修改 Context / Session

[`spec/context-composer.md`](spec/context-composer.md) → [`notes/session/session-domain-model.md`](notes/session/session-domain-model.md) → [`notes/session/fact-log-projections.md`](notes/session/fact-log-projections.md) → [`notes/context/context-window-roadmap.md`](notes/context/context-window-roadmap.md)

### 修改 LLM Provider / API 适配层

[`spec/llm-provider.md`](spec/llm-provider.md) → [`spec/llm-input.md`](spec/llm-input.md) → [`notes/llm/llm-provider-backlog.md`](notes/llm/llm-provider-backlog.md)

### 修改 Plugin / MCP / Sidecar

[`product/platform-strategy.md`](product/platform-strategy.md) → [`notes/runtime/plugin-host.md`](notes/runtime/plugin-host.md) → [`notes/runtime/ecosystem-compat.md`](notes/runtime/ecosystem-compat.md) → [`notes/runtime/runtime-multilang.md`](notes/runtime/runtime-multilang.md)

### 做 Harness Feature Eval

[`spec/harness-eval-1.0.md`](spec/harness-eval-1.0.md) → [`guides/feature-ab-eval.md`](guides/feature-ab-eval.md) → [`notes/evals/harness-eval-refactor-plan.md`](notes/evals/harness-eval-refactor-plan.md) → [`notes/evals/eval-release-artifact.md`](notes/evals/eval-release-artifact.md)

### 研究 Model–Harness Fit

[`notes/evals/model-harness-fit.md`](notes/evals/model-harness-fit.md) → [`notes/evals/harness-eval-refactor-plan.md`](notes/evals/harness-eval-refactor-plan.md) → [`notes/runtime/agent-runtime-product-direction.md`](notes/runtime/agent-runtime-product-direction.md)

### 修改 monorepo / Harness / CLI 结构

[`monorepo-packages.md`](notes/runtime/monorepo-packages.md) §18 → [`agent-harness-cli-split.md`](notes/runtime/agent-harness-cli-split.md)（**run-protocol · context? · agent · agent-cli**）→ [`TODO.md`](../TODO.md) §18

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

## 5. 模块级文档

以下说明与 `docs/` 并列维护，因为它们直接约束对应源码模块：

| 路径 | 内容 |
|------|------|
| [`packages/run-protocol/README.md`](../packages/run-protocol/README.md) | RunEvent protocol（RunEvent · RunConfig · Effect port） |
| [`packages/agent-core/README.md`](../packages/agent-core/README.md) | Temporal core（runLoop · RunEvent bus · resolveRunConfig） |
| [`packages/llm/README.md`](../packages/llm/README.md) | LLM（Provider Preset · routing · runLLM） |
| [`packages/agent/README.md`](../packages/agent/README.md) | MoonTide Harness 装配 |
| [`packages/agent-cli/README.md`](../packages/agent-cli/README.md) | CLI 产品（REPL · pipeline · stderr 渲染） |
| [`packages/tools/src/builtins/README.md`](../packages/tools/src/builtins/README.md) | Builtin tool 目录、spec/impl 结构和新增 checklist |
| [`packages/agent/src/plugins/builtin/README.md`](../packages/agent/src/plugins/builtin/README.md) | Builtin plugin 结构和 tool 声明规则 |
| [`packages/evals/README.md`](../packages/evals/README.md) | Eval package 当前命令与 artifact 说明 |

目录调整采用 clean break，不保留旧路径的转发文件。仓库内链接必须随移动同步更新。
