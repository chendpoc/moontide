# context 实现任务

## Review 批总览

| 批 | TASK | 主题 | 预估 diff |
|---|---|---|---:|
| R1 | CONTEXT-01–02 | R1 materialize：消息映射、tool round 聚合、配对校验与测试 | ~600 行 |

## TASK 明细

### CONTEXT-01: materialize 核心映射与聚合

- **做什么：** 实现 `context::materialize` 的只读扫描，将普通 session item、连续 `ToolCall` 和连续 `ToolResult` 映射为 provider-neutral `Message`。实现 checkpoint 透明处理，并保持同一 tool round 的聚合边界。
- **依赖：** 无
- **范围：** `crates/agent-core/src/context/mod.rs`、`crates/agent-core/src/context/materialize.rs`
- **预估 diff：** ~220 行
- **完成标准：** 通过普通消息、连续 call/result、checkpoint 与 JSON tool content 的行为测试
- **状态：** ☑

### CONTEXT-02: 配对校验与边界测试

- **做什么：** 补齐 call/result 身份、phase 顺序、dangling call、compaction 错误等 R1 不变量测试；每个测试注释说明场景、预期与副作用约束。
- **依赖：** CONTEXT-01
- **范围：** `crates/agent-core/src/context/tests.rs`
- **预估 diff：** ~380 行
- **完成标准：** `cargo test -p agent-core` 通过，且测试覆盖 DESIGN.md §4–§7 的 R1 边界
- **状态：** ☑
