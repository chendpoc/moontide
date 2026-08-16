# model_input implementation tasks

> 公开契约以 [`README.md`](README.md) 为准，实现边界以 [`DESIGN.md`](DESIGN.md) 为准。

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|----|------|------|-----------|------|
| R1 | 01–03 | 完整纯编译边界：公开值类型、compile 映射、结构测试与进度同步 | ~320 行 | ☑ |

`model_input` 的生产代码很小，拆成多个 review 批会割裂同一个结构映射。R1 因此一次交付完整模块；即使最终不足 300 行，也属于没有后继实现任务的单一逻辑边界。

## TASK 明细

### TASK-model-input-01：公开契约与模块出口

- **做什么：** 实现 `SystemPrompt`、`ModelRequestConfig`，并从 `agent-core` 暴露 `model_input`。保持 README 已确认的字段和方法，不增加 builder、trait 或额外 context 类型。
- **依赖：** 无
- **范围：** `crates/agent-core/src/model_input/mod.rs`、`crates/agent-core/src/lib.rs`
- **预估 diff：** ~70 行
- **完成标准：** `cargo check -p agent-core`
- **状态：** ☑

### TASK-model-input-02：ModelRequest 纯编译

- **做什么：** 实现 crate-private、infallible `compile`，原样移动 messages，并按冻结 registry 的稳定顺序精确映射 `ToolSpec` 为 `ToolSchema`。
- **依赖：** TASK-model-input-01
- **范围：** `crates/agent-core/src/model_input/compile.rs`、`crates/agent-core/src/model_input/mod.rs`
- **预估 diff：** ~50 行
- **完成标准：** `cargo check -p agent-core`
- **状态：** ☑

### TASK-model-input-03：结构测试与模块收尾

- **做什么：** 覆盖完整字段映射、tool schema 和顺序、messages 原样传递、空 system/registry、空 model/messages、零 max_tokens，以及同一 turn 多次 compile；同步模块 README、顶层 checklist 和内核进度。每个测试写明场景、预期与不变量/副作用约束。
- **依赖：** TASK-model-input-02
- **范围：** `crates/agent-core/src/model_input/tests.rs`、`crates/agent-core/src/model_input/README.md`、`crates/agent-core/README.md`、`.agents/skills/moontide-kernel-plan/PROGRESS.md`
- **预估 diff：** ~200 行
- **完成标准：** `just check`
- **状态：** ☑
