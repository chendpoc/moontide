# Context 与长期记忆候选路线

> **性质：** Candidate roadmap
> **状态：** Candidate / Deferred；当前 R1 边界见 [`../../../crates/agent-core/src/context/README.md`](../../../crates/agent-core/src/context/README.md)
> **来源：** 旧 TODO 的 Context Window、Prefix Cache、Normalization、Memory 和 Retrieval 条目

## Candidate

### Context 编译优化

- Prompt Prefix Cache：复用稳定的 system、project instructions 和 tool schema 前缀；
- provider-aware token budget 和 reserved output；
- compile 前后的 usage、delta 和输入体量观测；
- Context Manifest，记录选择、预算和配对结果。

### Compaction

- 在 compaction 前保留原始事实归档；
- summary、anchors、recent tail 和 checkpoint 的组合策略；
- compaction 失败时保留可恢复 Session Item Log；
- 以真实 Session 规模决定窗口和预算，而不是先定义通用 policy。

### Memory 与 Retrieval

- Session → memory 的显式蒸馏流程；
- L0/L1/L2 懒加载；
- 确定性 URI、检索轨迹和 provenance；
- 长期 memory 与短期 Session Item Log 分离。

## Deferred

- 当前 `materialize()` 只解决 SessionItem → Message 和 tool round closure；
- compaction、memory、retrieval、manifest 和预算对象都没有当前公共 API；
- 不因历史 TypeScript C1–C6 已完成就直接移植其实现。

## 进入条件

1. 有真实 Session context 压力或可重复的 token/latency 证据；
2. 明确原始事实、压缩产物和恢复边界；
3. 先完成架构对齐，再修改 `context` README/DESIGN 和公开签名。
