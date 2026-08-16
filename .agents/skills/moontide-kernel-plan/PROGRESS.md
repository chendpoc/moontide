# 开发进度

> 每个模块完成设计 / 实现 / 测试后，勾选对应状态并更新「当前目标」。
> 图例：☐ 未开始 · ◐ 进行中 · ☑ 完成

| # | 模块 | 层 | 依赖 | 设计文档 | 实现 | 测试 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | `llm` | 契约 | 无 | ☑ | ☑ | ☑ | R1–R6 完成；PR [#1](https://github.com/chendpoc/moontide/pull/1)–[#8](https://github.com/chendpoc/moontide/pull/8) |
| 2 | `session` | 契约 | llm + tools 契约 | ☑ | ☑ | ☑ | R1–R3 + v2 call/result payload |
| 3 | `tools` | 契约 | 无 | ☑ | ☑ | ☑ | RB1–RB2 + agent-tools R1；loop 集成归 loop 模块 |
| 4 | `event` | 契约 | llm + tools 契约 | ☑ | ☑ | ☑ | R1–R3 + typed call/result payload；R4 bus 待做 |
| 5 | `prompt` | 装配 | tools | ◐ | ☐ | ☐ | 架构对齐中；compile 唯一出口 |
| 6 | `context` | 装配 | session | ☐ | ☐ | ☐ | materialize + compaction |
| 7 | `loop` | 编排 | 1–6 全部 | ☐ | ☐ | ☐ | turn 状态机；查 ToolPermissionMap |
| 8 | `scheduler` | 后置 | llm + tools | ☐ | ☐ | ☐ | 分诊 + fan-out + delegate |

## 当前目标

- 模块 1–4 `llm` / `session` / `tools` / `event`：**设计、实现与测试完成**。
- `tools` 完成单次调用 runtime contract；`agent-tools` R1 完成静态 catalog 与 `grep` tracer bullet。permission 查表和 executor `Err` 配对顺序归后续 `loop`，不作为 tools 遗留项。
- 当前推进：模块 5 `prompt` **架构对齐**；先确认职责、公开 API 与 tools/LLM 接缝，用户确认前不落 README/DESIGN 或实现。

## 变更记录

- 2026-08-16：`tools` RB1–RB2、`agent-tools` R1 与 event/session typed payload 接缝完成；PR [#14](https://github.com/chendpoc/moontide/pull/14)、[#15](https://github.com/chendpoc/moontide/pull/15)、[#17](https://github.com/chendpoc/moontide/pull/17) 合并，workspace 门禁与独立最终 Review 通过；下一模块转入 `prompt` 架构对齐。
- 2026-08-16：`tools` RB2 收敛为 `ToolCall` / `ToolResult` 两个结构体；executor 直接返回 `ToolResult`，`Tool::execute` 校验身份和状态 owner；event/session 直接包装 canonical payload，Session v2 兼容读取 v1 缺失 status 为 `OutcomeUnknown`。
- 2026-08-16：`agent-tools` R1 完成独立 crate、最小 `ToolDefinition` 静态 catalog、内建 `grep` spec/executor 与有界文件搜索测试；双轴 Review 修复结构守门、typed-input、symlink/read IO 与 max-results 停止语义后通过。
- 2026-08-15：开始 `tools` 架构对齐；区分工具执行结果分类与 scheduler 模型 offload 验收/failover。
- 2026-08-16：`tools` 架构确认；落 README + DESIGN，明确单次执行边界与结果状态，offload 验收归 scheduler。
- 2026-08-16：`tools` 设计复核：执行前收敛为 input validation → permission check，不引入阶段对象、ToolAdmission 或 scheduler admission；实现暂缓至其余接缝复核完成。
- 2026-08-16：`tools` schema 复核：R1 只保留 Draft 2020-12 `input_schema`；`output_schema` 后置到出现明确结构化消费者后再评审。
- 2026-08-16：`tools` schema 错误边界确认：frozen registry 构造时校验并编译缓存 validator；非法 schema 阻止注册，调用 input 不匹配返回 `InvalidArguments` 并跳过 permission/executor。
- 2026-08-16：provider schema 兼容收敛：tools 保留 canonical schema；LLM adapter 默认透传，只对已确认关键词异常增加小型显式转换，不建设通用 schema 兼容系统。
- 2026-08-16：`ToolResultStatus` 收敛：R1 删除无独立语义或尚无 producer 的 `Unavailable`、`TimedOut`、`InternalError`；基础设施错误继续经 `anyhow::Result` 上抛。
- 2026-08-16：结果载荷收敛：删除无消费者且与 `ToolContent::Json` 重叠的 `structured`；RB2 进一步取消中间 output 模型，只保留 `ToolResult` 的单一 content。
- 2026-08-16：executor 参数收敛：删除 `ToolExecutionContext`；R1 只读借用 `&ToolCall` 并显式传入 `working_dir: &Path`，调用身份归 tools，run/session/turn 身份留在高层模块。
- 2026-08-16：scheduler 预设收敛：R1 删除无消费者且表达力不足的 `ToolExecutionPolicy`；真实资源模型在 scheduler 设计时再确认。
- 2026-08-16：permission 边界收敛：删除独立模块；`ToolSpec` 不含 permission，组合根维护 `ToolPermissionMap<tool_name, Allow | Ask>` 并校验与 registry key 集一致，`loop` 私有查表且运行时缺失安全拒绝。
- 2026-08-16：`ToolResult` 构造边界确认：字段跨 crate 只读；executor 使用受控成功/失败/未知构造器，loop 使用 crate 内 `with_status`，tools 统一组装并校验身份和状态 owner。
- 2026-08-16：单次调用内部 API 收口：registry 以 crate 内部 `validate_input(tool, call) -> Result<(), String>` 使用缓存 validator；`Tool::execute` 隐藏 executor 并直接返回 `ToolResult`。
- 2026-08-16：executor 基础设施错误配对规则确认：loop 先提交一次 `OutcomeUnknown` 的 `ToolResultRecorded`，再向 run 边界传播原始错误，禁止留下未配对的 `ToolCall`。
- 2026-08-16：tools RB1 规格门禁：schema validator 采用 `jsonschema` 0.49 且关闭 default features，固定 Draft 2020-12 并禁用外部 resolver；TASKS 补齐 lib/Cargo/Cargo.lock 范围，并把完整拒绝顺序归回 loop 集成。
- 2026-08-16：tools README / DESIGN / TASKS source-of-truth 对齐完成，规格门禁通过，进入 RB1 实现确认点。
- 2026-08-16：tools RB1 完成契约类型、冻结 registry、Draft 2020-12 validator 缓存、单次调用规范化与结构测试；workspace fmt/clippy/test 通过并完成 Review；下一批转入 `agent-tools`。
- 2026-08-15：session R3（commit_from_event + SessionCommitHandler）+ event R3（FileAgentEventWriter + 集成测试）。
- 2026-08-15：session R2（fork + Compaction/Checkpoint）+ event R2（derive + 64KiB 截断）；68 tests。
- 2026-08-15：`session` 设计文档 draft 落盘；归档 4 份 TS 时代文档 + 更新 doc map。
- 2026-08-15：`llm` 合入 `main`（PR #8）；开始 `session` 架构对齐。
- 2026-08-14：`llm` 实现完成（R1 契约 · R2 normalize · R3 adapter · R4 不变量单测；38 tests）。
- 2026-08-14：父 skill 重命名为 `moontide-kernel-plan`（原 moontide-roadmap-v1-dev-plan）。
- 2026-08-14：`llm` 架构对齐完成，设计文档落盘（MoonTide protocol + AdapterFamily + normalize 混合结构；默认 DeepSeek × OpenAiChatCompletions）。
- 2026-08-14：推进模板改为「先架构对齐、用户确认后再落文档/实现」；开始 `llm` 对齐。
- 2026-08-14：skill 创建；当时按 9 模块规划，2026-08-16 复核后删除独立 permission 模块。
