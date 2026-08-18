# MoonTide 产品未来方向

> **性质：** Product candidates
> **状态：** Candidate / Deferred，不属于当前 Desktop Shell v0.1 承诺
> **当前产品计划：** [`plan.md`](plan.md)
> **历史来源：** [`../archive/notes/runtime/todo-legacy-2026-08.md`](../archive/notes/runtime/todo-legacy-2026-08.md)

## Desktop 产品线

- Tide：日常 Action 摘要和时间线；
- Fleet：多个 Agent、后台任务和运行状态的统一面板；
- Buoy：Spark capture 同步到 Desktop 的 pending inbox；
- Project tree、对话标签和自动分类；
- 多 panel、多窗口和可停靠桌面工作区；
- 网络不可达、依赖失败和本地/云端降级的用户体验。

## 远期产品线

- Spark：移动端 capture / draft / sync；
- Zephyr：跨 Agent 产品的会话和任务迁移；
- 更强的本地模型和离线工作流；
- 面向特定工作流的 Domain Pack 与结果验收。

## 不纳入当前承诺

- 虚拟人物；
- 多 Agent 产品化；
- 跨设备同步的完整实现；
- 在没有用户、数据和验收闭环前建设完整商业化产品线。

每个方向进入实现前，都必须补充目标用户、使用场景、数据来源、权限/隐私边界、依赖和可验证结果；产品愿景不能直接改变 `agent-core` 契约。
