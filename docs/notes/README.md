# Notes 索引

`notes/` 保存分析、候选、研究、讨论和开发计划。这里的文档默认**不是当前 Rust 契约**；当前系统设计见 [`../../crates/docs/`](../../crates/docs/)，模块细节见对应源码 README/DESIGN，执行优先级见根 [`TODO.md`](../../TODO.md)。

TS 时代的讨论与实现文档已归档到 [`../archive/`](../archive/)，不参与当前契约，也不在下列索引中。

## Runtime

| 文档 | 职责 |
|------|------|
| [`runtime/agent-kernel-architecture.md`](runtime/agent-kernel-architecture.md) | 内核架构收敛：Pi 教训、模型 daemon、验收网关、subagent、A2A、crate 判据、多语言 trade-off、event bus 与决策清单 |
| [`runtime/agent-runtime-product-direction.md`](runtime/agent-runtime-product-direction.md) | 元 agent、共享 Runtime 与产品 Preset / Shell 边界 |
| [`runtime/runtime-multilang.md`](runtime/runtime-multilang.md) | 多语言 Desktop Runtime、sidecar 与 IPC |
| [`runtime/kocoro-architecture.md`](runtime/kocoro-architecture.md) | Kocoro/Shannon 参考架构分析 |

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
