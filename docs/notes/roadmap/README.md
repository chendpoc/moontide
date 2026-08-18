# MoonTide 候选路线

> **性质：** Candidate roadmap
> **状态：** 不属于当前执行路线；进入实现前必须重新完成目标、owner、接口和验收对齐。
> **当前执行路线：** [`../../../TODO.md`](../../../TODO.md)
> **历史来源：** [`../../archive/notes/runtime/todo-legacy-2026-08.md`](../../archive/notes/runtime/todo-legacy-2026-08.md)

## 状态约定

| 状态 | 含义 |
|---|---|
| `Candidate` | 保留想法，尚未承诺 |
| `Ready for Alignment` | 问题和触发条件较清楚，可以进入架构对齐 |
| `Deferred` | 有价值，但当前没有真实消费者或资源条件 |
| `Rejected` | 已明确不纳入当前产品方向 |

## 工程候选

| 文档 | 领域 |
|---|---|
| [`desktop-candidates.md`](desktop-candidates.md) | Desktop Shell 后续交互和工作台能力 |
| [`runtime-candidates.md`](runtime-candidates.md) | Runtime、扩展、跨语言和本地模型 |
| [`context-candidates.md`](context-candidates.md) | Context、compaction、memory 和 retrieval |
| [`evaluation-candidates.md`](evaluation-candidates.md) | 评测、benchmark 和 prompt quality |

候选文档不能改变当前 `agent-core` 契约，也不能绕过 README/DESIGN 和 TASKS 的设计门禁。
