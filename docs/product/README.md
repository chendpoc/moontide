# Product 文档

`product/` 记录产品定位、目标用户、产品边界和长期方向，不定义底层实现契约。

产品文档状态分为：`Confirmed baseline`（当前已确认方向）、`Proposal`（待确认）、`Historical`（仅供追溯）。产品文档不能覆盖 `AGENTS.md`、`crates/docs/` 或模块 README/DESIGN 的系统契约。

| 文档 | 职责 |
|------|------|
| [`vision.md`](vision.md) | MoonTide 产品定位、命名与产品族方向 |
| [`plan.md`](plan.md) | 当前已确定的产品设计与交付边界 |
| [`platform-strategy.md`](platform-strategy.md) | Release、扩展生态、MCP/sidecar 与竞争定位 |
| [`spark.md`](spark.md) | Spark 移动端产品边界及与 MoonTide Runtime 的关系 |
| [`desktop-development-direction.md`](desktop-development-direction.md) | Desktop Shell 下一阶段能力清单与 `agent-core` 完成度判断（已确认基线） |
| [`mature-product-direction.md`](mature-product-direction.md) | 成熟产品能力地图，以及 Remote Compute / Model Runtime 演进方向 |
| [`competitor-solution-matrix.md`](competitor-solution-matrix.md) | Agent CLI 竞品的问题、能力、调用机制和产品取舍研究 |
| [`moontide-capability-model.md`](moontide-capability-model.md) | MoonTide 自有能力模型，以及从能力到功能、架构和验收的推导规则 |
| [`future-directions.md`](future-directions.md) | 从历史 TODO 提炼的产品候选方向，不属于当前承诺 |

产品方向需要落地为系统契约时，在 [`../spec/`](../spec/) 建立或更新对应 Spec；未进入实现的技术候选放入 [`../notes/`](../notes/)。
