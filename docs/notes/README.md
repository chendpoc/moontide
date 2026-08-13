# Notes 索引

`notes/` 保存分析、候选、研究、讨论和开发计划。这里的文档默认**不是当前实现契约**；当前契约见 [`../spec/`](../spec/)，执行优先级见根 [`TODO.md`](../../TODO.md)。

## Runtime

| 文档 | 职责 |
|------|------|
| [`runtime/agent-core-roadmap.md`](runtime/agent-core-roadmap.md) | Agent Core 的迁移与实现顺序 |
| [`runtime/agent-run-hooks.md`](runtime/agent-run-hooks.md) | Legacy hook 机制、迁移状态与工程落点 |
| [`runtime/agent-runtime-api.md`](runtime/agent-runtime-api.md) | AgentRuntime / Agent / AgentSession / AgentRun 目标 API 与 capability 完成标准 |
| [`runtime/agent-runtime-product-direction.md`](runtime/agent-runtime-product-direction.md) | 元 agent、共享 Runtime 与产品 Preset / Shell 边界 |
| [`runtime/agent-kernel-architecture.md`](runtime/agent-kernel-architecture.md) | 内核架构收敛：Pi 教训、模型 daemon、验收网关、subagent、A2A、crate 判据、多语言 trade-off、event bus 与决策清单 |
| [`runtime/architecture-remediation.md`](runtime/architecture-remediation.md) | TypeScript Harness 架构修复计划 |
| [`runtime/ecosystem-compat.md`](runtime/ecosystem-compat.md) | Codex / Claude Code 配置与 MCP 兼容边界 |
| [`runtime/plugin-host.md`](runtime/plugin-host.md) | Plugin host、MCP client 与 sidecar attach |
| [`runtime/runtime-multilang.md`](runtime/runtime-multilang.md) | 多语言 Desktop Runtime、sidecar 与 IPC |
| [`runtime/monorepo-packages.md`](runtime/monorepo-packages.md) | Monorepo 包、依赖图和开发启动 |
| [`runtime/agent-harness-cli-split.md`](runtime/agent-harness-cli-split.md) | §18 主轨 + DR-A run-protocol + DR-B context?（TODO §18） |
| [`runtime/schema-package-plan.md`](runtime/schema-package-plan.md) | `@moontide/schema` 候选方案 — **deferred / no-go**（§0 Revisit 条件）；import 以 [`type-imports.md`](../spec/type-imports.md) 为准 |
| [`runtime/utils-infrastructure.md`](runtime/utils-infrastructure.md) | Utils、storage 和 Node/OS 原语分层 |
| [`runtime/kocoro-architecture.md`](runtime/kocoro-architecture.md) | Kocoro/Shannon 参考架构分析 |
| [`runtime/scratchpad.md`](runtime/scratchpad.md) | `scratch.eval` 低风险草稿执行候选 |

## Context

| 文档 | 职责 |
|------|------|
| [`context/context-window-roadmap.md`](context/context-window-roadmap.md) | Context 主路径完成状态与后续轨道 |
| [`context/context-analysis.md`](context/context-analysis.md) | 行业 Context 架构对比 |
| [`context/context-backlog.md`](context/context-backlog.md) | Context Composer 演进候选 |
| [`context/context-normalization.md`](context/context-normalization.md) | Preflight / Postflight Normalization 候选 |
| [`context/context-inspect-debug.md`](context/context-inspect-debug.md) | Compose / LLM / tool 全量 debug dump |
| [`context/deep-mode.md`](context/deep-mode.md) | 当前 Deep Task Mode 行为 |
| [`context/deep-mode-redesign.md`](context/deep-mode-redesign.md) | Deep Mode 与 work_mem 重设计草案 |
| [`context/agent-activity-model-discussion.md`](context/agent-activity-model-discussion.md) | Agent Activity Model 讨论 |
| [`context/self-review-mode.md`](context/self-review-mode.md) | 基于日志的受控 Self-Review 候选 |
| [`context/truncation-strategies.md`](context/truncation-strategies.md) | Tool result truncation 的恢复提示 |
| [`context/web-content-retrieval-discussion.md`](context/web-content-retrieval-discussion.md) | 外网正文与 artifact retrieval 讨论 |

## Session

| 文档 | 职责 |
|------|------|
| [`session/session-domain-model.md`](session/session-domain-model.md) | Session 类型、owner 与 compose 数据流 |
| [`session/fact-log-projections.md`](session/fact-log-projections.md) | Session 事实与 Run 观测的双源流边界 |
| [`session/session-log-migration.md`](session/session-log-migration.md) | Loop 向 Session Item Log 的迁移策略 |
| [`session/session-persistence.md`](session/session-persistence.md) | Session Index、保存与恢复 |
| [`session/session-handoff.md`](session/session-handoff.md) | 跨 agent 会话和 artifact 交接候选 |

## Evals

| 文档 | 职责 |
|------|------|
| [`evals/agent-eval-roadmap.md`](evals/agent-eval-roadmap.md) | Feature Eval L0–L3 路线图 |
| [`evals/agent-eval-task-taxonomy.md`](evals/agent-eval-task-taxonomy.md) | Workload、Harness contract、API profile 与 oracle 分类 |
| [`evals/harness-eval-refactor-plan.md`](evals/harness-eval-refactor-plan.md) | Contract-first eval 重构计划 |
| [`evals/eval-release-artifact.md`](evals/eval-release-artifact.md) | Pinned agent artifact 与 headless eval 协议 |
| [`evals/model-harness-fit.md`](evals/model-harness-fit.md) | Model–Harness Fit 与 Harness Profile 研究方向 |

## LLM

| 文档 | 职责 |
|------|------|
| [`llm/llm-provider-backlog.md`](llm/llm-provider-backlog.md) | API 适配层后续工作 |
| [`llm/edge-local-models.md`](llm/edge-local-models.md) | Local Fusion、edge model catalog 与路由候选 |

## Generated proposals

[`tool-hints/`](tool-hints/) 是 `record_tool_hint` 的写入位置，由 Rust 实现和测试引用。该目录保持稳定，不随 notes 分类移动；其中内容只供人工审核，不自动应用到工具实现。
