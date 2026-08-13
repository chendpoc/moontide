# Spec 文档

`spec/` 是当前认可的系统设计契约。Spec 描述 owner、接口、状态边界、不变量和错误语义；实现变化后应同步更新。

| 文档 | 职责 |
|------|------|
| [`agent-core.md`](agent-core.md) | Agent 时序内核、RunConfig、RunEvent 与扩展边界 |
| [`agent-events.md`](agent-events.md) | Agent Event Log 的 schema 与持久化边界 |
| [`context-composer.md`](context-composer.md) | Session、Context Composer、Compaction 与 Context Manifest |
| [`llm-provider.md`](llm-provider.md) | Provider preset、路由、API 适配层与 `LLMRequest` |
| [`llm-input.md`](llm-input.md) | 一次 LLM 请求的 system、tools、messages 对表 |

候选设计、迁移顺序和尚未实现的工作不得直接写成当前 Spec；先放入 [`../notes/`](../notes/)，达到验收条件后再提升。
