# tools 实现任务

> 依据 [`README.md`](README.md) 对外契约与 [`DESIGN.md`](DESIGN.md) 技术方案拆分。
> RB1 覆盖 tools 的单次调用基础能力；RB2 将生命周期收敛为 `ToolCall` / `ToolResult` 并让 event/session 直接复用。组合根声明的 `ToolPermissionMap` 与查表顺序仍由后续 loop 集成批验证，不引入独立 permission 模块或 scheduler 的多调用策略。
> executor `Err` 的配对规则属于后续 loop 集成：tools 只验证 `Tool::execute` 原样传播错误；loop 必须先提交 `OutcomeUnknown`，再把同一错误返回 run 边界。
> provider schema 关键词兼容属于后续 LLM adapter 接缝；RB1 不实现通用转换层、capability 矩阵或 provider profile。
> 公开签名已在 README/DESIGN 冻结；实现发现契约缺口时必须停批回到设计评审。

## RB1 范围

- **允许修改：** `crates/agent-core/src/tools/**`、`crates/agent-core/src/lib.rs`、根 `Cargo.toml`、`crates/agent-core/Cargo.toml`、`Cargo.lock`。
- **禁止修改：** `llm`、`session`、`event` 的 Rust 实现，以及尚不存在的 loop/scheduler/agent 实现；R4 typed status 接缝不混入 RB1。
- **schema 依赖：** workspace 增加 `jsonschema = { version = "0.49", default-features = false }`；固定 Draft 2020-12，禁用 HTTP/file resolver。
- **验证：** 单个 TASK 先跑相关测试；RB1 完成后跑 `just check`。

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|---|---|---|---:|---|
| RB1 | tools-01–04 | 契约类型、冻结 registry、单次调用规范化与结构测试（覆盖 DESIGN R1–R3） | ~900–1400 行 | ☑ |
| RB2 | tools-05–08 | `ToolCall` / `ToolResult` 唯一建模与 event/session 复用 | ~800–1400 行 | ☑ |

## TASK 明细

### TASK-tools-01: 建立纯契约类型与唯一执行端口

- **做什么：** 实现只含模型能力声明的 `ToolSpec`、`ToolCall`、私有字段且只读访问的 `ToolResult` 及其状态/内容类型。实现唯一的 `ToolExecutor` trait，调用以 `&ToolCall` 只读借用传入，工作目录通过显式 `working_dir: &Path` 参数传入。类型层不执行 IO，不依赖高层模块，不包含 permission map，也不预设 scheduler 执行策略。RB2 最终取消中间 `ToolOutput`，executor 直接返回 `ToolResult`。
- **依赖：** 无
- **范围：** `mod.rs`、`spec.rs`、`call.rs`、`executor.rs`、`result.rs`、`crates/agent-core/src/lib.rs`
- **预估 diff：** ~300 行
- **完成标准：** `cargo check -p agent-core` 通过，构造器/访问器与 README 修订版一致
- **状态：** ☑

### TASK-tools-02: 实现冻结且稳定的工具 registry

- **做什么：** 实现 `Tool` 与 `ToolRegistry` 的重名拒绝、稳定排序、名称解析和 frozen snapshot；引入关闭 default features 的 `jsonschema` 0.49，先按 Draft 2020-12 meta-schema 校验，再编译并缓存每个 input validator，禁止 HTTP/file resolver；任一 schema 非法则整体返回含工具名上下文的错误。同一 `Tool` 同时提供 schema 与 executor，冻结后不可变。
- **依赖：** TASK-tools-01
- **范围：** `registry.rs`、`mod.rs`、根 `Cargo.toml`、`crates/agent-core/Cargo.toml`、`Cargo.lock`
- **预估 diff：** ~220 行
- **完成标准：** registry 构造/解析/迭代与 schema 编译缓存可由纯单测验证；非法 schema 不产生部分 registry；不引入 permission、scheduler 或 session 依赖
- **状态：** ☑

### TASK-tools-03: 实现输入/输出校验与单次调用规范化

- **做什么：** 实现调用身份、缓存的 Draft 2020-12 input 校验与 executor 调用。registry 仅增加 crate 内部 `validate_input(tool, call) -> Result<(), String>`；`Tool::execute` 隐藏 executor、返回 `ToolResult` 并核验结果身份。`UnknownTool` / `InvalidArguments` 的完整管线映射与“executor 未调用”顺序由未来 loop 集成测试负责。只处理一个 `ToolCall`；不实现 output schema、provider schema 转换、permission、admission、并发、取消树、重试或 offload 验收。
- **依赖：** TASK-tools-01、TASK-tools-02
- **范围：** `validate.rs`、`result.rs`、`registry.rs`
- **预估 diff：** ~400 行
- **完成标准：** `resolve` 未命中返回 `None`；非法 input 返回确定性错误文本；`Tool::execute` 正确映射成功、业务失败及 retryable、`OutcomeUnknown`，并原样传播基础设施错误
- **状态：** ☑

### TASK-tools-04: 补充有明确注释的结构与行为测试

- **做什么：** 为 RB1 不变量建立纯测试；每个测试用中文注释说明测试场景、预期结果和不变量/副作用约束，覆盖重复注册、稳定顺序、不可变访问、`resolve` 未命中、非法 input、业务失败 retryable、未知副作用和错误原样传播。unknown/invalid 的完整拒绝顺序、permission 顺序与 executor `Err` 的 `OutcomeUnknown → commit → 原错误上抛` 顺序留到 loop 集成测试。
- **依赖：** TASK-tools-01、TASK-tools-02、TASK-tools-03
- **范围：** `tests.rs`、必要时各实现文件的测试模块
- **预估 diff：** ~300 行
- **完成标准：** `cargo test -p agent-core` 通过，测试不依赖真实 shell、网络或持久化文件
- **状态：** ☑

### TASK-tools-05: 收敛调用与结果契约

- **做什么：** 让 `ToolCall` / `ToolResult` 成为单次调用生命周期仅有的两个结构体；删除 `ToolOutput`，由 executor 直接返回受控构造的 `ToolResult`，并在 `Tool` 边界校验返回身份。
- **依赖：** TASK-tools-01–04
- **范围：** `call.rs`、`result.rs`、`executor.rs`、`registry.rs`、`mod.rs`
- **预估 diff：** ~260 行
- **完成标准：** `cargo test -p agent-core tools::` 通过；公开 API 与 README 一致
- **状态：** ☑

### TASK-tools-06: 迁移 builtin 与 tools 测试

- **做什么：** 将 `agent-tools::grep` 和 tools 测试迁移到 `Result<ToolResult>`；覆盖成功、预期失败、未知结果、基础设施错误及 executor 返回错误调用身份。
- **依赖：** TASK-tools-05
- **范围：** `crates/agent-tools/src/grep/executor.rs`、`tools/tests.rs`
- **预估 diff：** ~260 行
- **完成标准：** `cargo test -p agent-tools` 与 tools 测试通过
- **状态：** ☑

### TASK-tools-07: event/session 复用唯一 payload

- **做什么：** `RunEvent` 与 `SessionItem` 直接包装 `ToolCall` / `ToolResult`，删除 invocation/outcome 同义字段组；Session header 升到 v2，并保留 v1 读取时缺失 status → `OutcomeUnknown` 的迁移语义。
- **依赖：** TASK-tools-05
- **范围：** `event/{run_event,derive,pipeline,tests}.rs`、`session/{types,commit,store,tests}.rs`
- **预估 diff：** ~500 行
- **完成标准：** event/session 映射、serde、v1 load/fork 测试通过
- **状态：** ☑

### TASK-tools-08: 同步架构契约与结构守门

- **做什么：** 更新 tools/event/session/agent-tools 文档与术语表，守门调用生命周期只出现 `ToolCall` / `ToolResult` 两个结构体建模。
- **依赖：** TASK-tools-05–07
- **范围：** 相邻模块 README/DESIGN/TASKS、`UBIQUITOUS_LANGUAGE.md`、结构测试
- **预估 diff：** ~300 行
- **完成标准：** `just check` 等价 workspace 门禁通过，全文搜索无活动的 invocation/outcome/output 同义模型
- **状态：** ☑

## 验收映射

| 契约 | RB1 验证 |
|---|---|
| 公开签名与可见性 | 编译测试 + API 使用测试 |
| schema 固定 Draft 2020-12、无外部 resolver | registry 构造测试 + 非法/外部 `$ref` 测试 |
| frozen registry、稳定顺序、同一 spec/executor 绑定 | registry 行为测试 |
| input validation 使用缓存且返回预期错误 | validation 行为测试 |
| executor 直接返回 `ToolResult` 并保留状态/retryable | result / execute 行为测试 |
| executor 不能替换调用身份 | identity mismatch 行为测试 |
| event/session 只包装 call/result；v1 可恢复 | 映射、serde 与 load 兼容测试 |
| executor `Err` 不在 tools 内吞掉或改写 | execute 错误传播测试 |
| workspace 质量门禁 | `just check` |
