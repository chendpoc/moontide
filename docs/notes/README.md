# Notes 索引

`notes/` 保存分析、候选、研究、讨论和开发计划。这里的文档默认**不是当前 Rust 契约**；当前系统设计见 [`../../crates/docs/`](../../crates/docs/)，模块细节见对应源码 README/DESIGN，执行优先级见根 [`TODO.md`](../../TODO.md)。

文档状态分为：`Candidate`（候选设计）、`Research`（调研分析）、`Plan`（开发计划）、`Historical`（已被当前文档替代）。notes 中的“定稿”或“完成”不自动改变当前实现契约。

TS 时代的讨论与实现文档已归档到 [`../archive/`](../archive/)，不参与当前契约，也不在下列索引中。

## Runtime

| 文档 | 职责 |
|------|------|
| [`runtime/agent-kernel-architecture.md`](runtime/agent-kernel-architecture.md) | 内核架构收敛：Pi 教训、模型 daemon、验收网关、subagent、A2A、crate 判据、多语言 trade-off、event bus 与决策清单 |
| [`runtime/agent-runtime-product-direction.md`](runtime/agent-runtime-product-direction.md) | 元 agent、共享 Runtime 与产品 Preset / Shell 边界 |
| [`runtime/runtime-host-architecture.md`](runtime/runtime-host-architecture.md) | CLI、Desktop、Frontend、Runtime Host 与 Agent Worker 的渐进式架构候选 |
| [`runtime/runtime-multilang.md`](runtime/runtime-multilang.md) | 多语言 Desktop Runtime、sidecar 与 IPC |
| [`runtime/kocoro-architecture.md`](runtime/kocoro-architecture.md) | Kocoro/Shannon 参考架构分析 |
| [`runtime/budget-aware-agent-harness.md`](runtime/budget-aware-agent-harness.md) | Agent Harness 的 OS 类比、预算感知任务拆分、JIT Context、语义调度与 pi-dynamic-workflow 启发 |
| [`runtime/declarative-permission-rules-refactor.md`](runtime/declarative-permission-rules-refactor.md) | Tool permission 声明式规则与运行时 map 的小范围重构方案 |
| [`runtime/loop-owned-llm-event-consumption-refactor.md`](runtime/loop-owned-llm-event-consumption-refactor.md) | Loop 统一消费 provider-neutral LLM 事件流的候选重构需求 |

## Context

| 文档 | 职责 |
|------|------|
| [`context/context-analysis.md`](context/context-analysis.md) | 行业 Context 架构对比 |

## Session

| 文档 | 职责 |
|------|------|
| [`session/session-handoff.md`](session/session-handoff.md) | 跨 agent 会话和 artifact 交接候选 |

## LLM

| 文档 | 职责 |
|------|------|
| [`llm/edge-local-models.md`](llm/edge-local-models.md) | Local Fusion、edge model catalog 与路由候选 |

## Generated proposals

[`tool-hints/`](tool-hints/) 是 `record_tool_hint` 的写入位置，由 Rust 实现和测试引用。该目录保持稳定，不随 notes 分类移动；其中内容只供人工审核，不自动应用到工具实现。

## Roadmap candidates

[`roadmap/README.md`](roadmap/README.md) 保存从历史 TODO 提炼出的工程候选，不改变根 `TODO.md` 的当前执行优先级。
