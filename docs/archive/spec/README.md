# Archived Specs

> TypeScript 时代的系统设计与已废弃规格，仅供追溯；不参与当前 Rust 架构裁决。内部链接可能已失效。

| 文档 | 历史主题 | 当前替代 |
|------|----------|----------|
| [`agent-core.md`](agent-core.md) | TypeScript Agent Core、hooks 与事件时序 | [`crates/docs/agent-core.md`](../../../crates/docs/agent-core.md) |
| [`agent-events.md`](agent-events.md) | Agent Event Log schema | [`event/DESIGN.md`](../../../crates/agent-core/src/event/DESIGN.md) |
| [`context-composer.md`](context-composer.md) | Context Composer、Compaction、Manifest | Rust context 尚待架构对齐；已确认边界见 [`crates/docs/agent-core.md`](../../../crates/docs/agent-core.md) |
| [`llm-input.md`](llm-input.md) | LLM 三类输入对表 | [`model_input/DESIGN.md`](../../../crates/agent-core/src/model_input/DESIGN.md) |
| [`llm-provider.md`](llm-provider.md) | Provider preset、router 与 adapter 方案 | [`llm/DESIGN.md`](../../../crates/agent-core/src/llm/DESIGN.md) |
| [`harness-eval-1.0.md`](harness-eval-1.0.md) | 旧 Harness 评测规格 | 无当前替代 |
| [`repl-terminal.md`](repl-terminal.md) | 旧 REPL terminal 规格 | 无当前替代 |
| [`type-imports.md`](type-imports.md) | 旧 TypeScript import 规则 | Rust 工程手册 |
