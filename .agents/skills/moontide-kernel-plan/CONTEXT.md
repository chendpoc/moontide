# 讨论上下文索引

> 历次设计讨论沉淀的位置与主题。以下路径均相对于项目根 `/Users/chenjiayu/code/agent-learning/moontide/`。

## 候选设计文档（`crates/docs/`）

| 文档 | 主题 |
|---|---|
| `crates/docs/extension-request-pipeline.md` | 插件设计 Agent：用户扩展需求处理链路（意图澄清 → 判断 → draft → review → judge 门禁） |
| `crates/docs/tiered-context-memory.md` | 分层 Context 与长期记忆：L0/L1/L2 懒加载 + session→memory 蒸馏（借鉴 OpenViking） |
| `crates/docs/extension-sidecar-runtime.md` | 扩展边界与 Sidecar Runtime：通信四层、隔离、runtime 成本分配（共享 runtime 默认） |
| `crates/docs/logging-and-session-design.md` | 日志与 Session：三流分离 + session log 四不变量 + 双写原则 |

## 当前 Rust 契约与架构

| 文档 | 主题 |
|---|---|
| `crates/docs/agent-core.md` | Rust Agent Core 系统设计：八模块 owner、依赖、请求组装与 conformance |
| `crates/agent-core/src/event/DESIGN.md` | Rust Agent Event、derive、dispatcher 与 recorder 边界 |
| `docs/archive/spec/context-composer.md` | TypeScript 历史 Context Composer，仅供追溯 |
| `docs/notes/runtime/agent-kernel-architecture.md` | 内核架构收敛：crate 判据、多语言 trade-off、event bus、决策清单 |

## 关键设计决策速查

1. **三流分离**：session log（可重放事实）· logger（可丢弃诊断，stderr）· stdout（外部消费数据）。判断标准：模型可见 / resume 要知道 → session log；否则 → logger。
2. **session 四不变量**：`seq == log.len()`、先校验后冻结、模型可见先入 log、header 外置。
3. **扩展边界**：sidecar（进程间）+ MCP（JSON-RPC over stdio）；隔离靠 OS 进程边界强制，非约定。
4. **runtime 成本**：共享 runtime 默认（O(版本数)），embedded（打包单文件）例外（O(N) 重复）。
5. **双写原则**：生命周期事实双写——session log 记「发生了什么」，logger 记「怎么发生」。
6. **错误建模**：取消原因（user/parent/hook/disposed）与请求失败（可恢复/不可恢复）是两个正交枚举；steer 是独立通道。
7. **llm 分层（2026-08-14）**：`llm/protocol/` = MoonTide 协议（block 模型）；`LLMProvider` = 唯一 trait；`AdapterFamily` = wire 协议族（与 preset 解耦）；每个 family 必须配对 `adapter/{family}/` + `normalize/{family}/`（族内 tool/thinking/stream）；跨族逻辑仅 `normalize/common.rs`；preset/路由在 `agent/`，不在 llm；首版 DeepSeek 默认 `OpenAiChatCompletions`。用法 [`llm/README.md`](../../../crates/agent-core/src/llm/README.md)；实现 [`llm/DESIGN.md`](../../../crates/agent-core/src/llm/DESIGN.md)。
8. **llm 流式消费（2026-08-15）**：`ModelStreamEvent`（含 `block_index`）由 adapter 产出；`ModelResponseBuilder` 唯一 fold → `ModelResponseSnapshot`（含 `pending`）/ `ModelResponse`；loop 经 `run_model_call*`（禁止直接 match 事件）；`Finished` 非全文 Completed；lifecycle 归 `RunEvent`。
9. **实现子流程**：README ☑ → [`batch-implement`](batch-implement/SKILL.md)——Review 批合并交付；GitHub stacked PR：`r1→base`，`r{n≥2}→r{n−1}`，R{n−1} merge 后 rebase 改 base；模块完成 `base→main`。

> model_input 最终设计（2026-08-16）：模块名从 `prompt` 收敛为 `model_input`，作为 `ModelRequest` 唯一运行时构造出口；公开 `SystemPrompt`、`ModelRequestConfig` 与 infallible `compile(config, system_prompt, messages, tool_registry)`。`SystemPrompt` 由 `agent` 每 user turn 解析一次并在 turn 内稳定；`compile` 每 model step 调用。messages 由 `context::materialize` 原样交付，compaction/prune/retrieval/manifest 归 context；tool schemas 从冻结 registry 稳定、精确映射；provider 兼容和请求 preflight 仍归 llm。

> context R1 契约（2026-08-17）：`pub(crate) fn materialize(items: &[SessionItem]) -> anyhow::Result<Vec<Message>>` 是 Session Item Log 到 model-visible messages 的唯一出口。`UserMessage` / `AssistantMessage` 直接映射；连续 `ToolCall` 聚合为一个 assistant tool-use message；连续 `ToolResult` 聚合为一个 user tool-result message；`CheckpointCreated` 只作 metadata 忽略且不打断聚合；`Compaction` 在 R1 显式返回错误。materialize 只读，不写 session、不执行 compaction/prune/retrieval、不引入 manifest、预算对象或 token counter trait；tool call/result 必须按 `tool_use_id`（及对应 name）成对，否则返回错误。一个 call 段未闭合前不得开启下一 call 段。`ToolResultStatus` 保留在 session/loop 控制语义中，不改写为 provider message 字段。

> tool-call round closure（2026-08-17）：一个连续 `ToolCall` 段是一次 round；下一次 model step 前，round 内每个 call 都必须存在配对的 `ToolResult`。context 只验证 Session Item Log 中的 round 是否闭合，不预设并发、deadline、join、timeout 或状态映射；这些执行政策留到 `loop` / `scheduler` 架构对齐。

> Message transform ownership（2026-08-17）：`Message` 是 MoonTide provider-neutral 的 canonical model-input record，不是 provider wire payload，也不是持久化 SessionItem。`context` 只负责 `SessionItem → Message`；`llm::adapter` 负责完整 `ModelRequest → provider wire request`，其中包含 Message、system、tools 与 request config 的转换。R1 不在 `Message` 上公开通用 `Transform<Target>` trait；如某 adapter 需要方法语法，只能在 adapter 内使用私有 extension trait。

> tools 最终设计（2026-08-16）：公开类型使用构造器与只读访问器；registry 构造即冻结、稳定排序并编译缓存 input validator，非法 schema 阻止整个 registry；使用关闭 default features 的 `jsonschema` 0.49，固定 Draft 2020-12 并禁用 HTTP/file resolver；registry 仅以 crate 内部 `validate_input(tool, call) -> Result<(), String>` 暴露预期参数错误，`Tool::execute` 隐藏 executor、直接返回 `ToolResult`，并校验结果 identity 与 executor 可拥有的 status。执行前只保留 input validation 与 permission check，不引入阶段型 call、ToolAdmission 或 scheduler admission；R1 只保留 `input_schema`，`output_schema` 后置；tools 保留 canonical schema，LLM adapter 默认透传且只对已确认关键词异常做小型显式转换。调用生命周期只使用 `ToolCall` / `ToolResult` 两个结构体；不存在 `ToolOutput` / invocation / outcome 中间模型。结果载荷为带显式 serde tag 的 `ToolContent::Text | Json`；executor 使用 `succeeded` / `failed` / `outcome_unknown` 构造结果，loop 通过 crate 内 `with_status` 生成 pipeline-owned 状态。基础设施错误走 `anyhow::Result`，loop 先提交 `OutcomeUnknown` 配对结果再传播原错误。executor 只读借用 `&ToolCall` 并显式接收 `working_dir: &Path`；run/session/turn 身份留在高层。permission 不进入 `ToolSpec`，组合根维护 `ToolPermissionMap<tool_name, Allow | Ask>`，完整拒绝顺序归 loop 集成测试；scheduler 的资源、并发、重试和 offload/failover 仍在后置模块。

> Tool Library 边界（2026-08-16）：`agent-core::tools` 保留单次调用 runtime contract，不合入具体工具库；独立 `agent-tools` crate 按域存放 bash/grep/web_fetch 等第一方 spec/executor，公开 `ToolDefinition { name + build }` catalog；agent preset 声明 tool names，bootstrap build 为 `Vec<Tool>` 后冻结 `ToolRegistry`。依赖只能是 `agent-tools → agent-core`，不引入 `ToolLibrary` struct、外部 manifest、通用 build context 或第二套 registry。

## TODO 关联条目

`TODO.md`：16 内核 Rust 化（当前主轨）· 17 跨语言契约 · 18 多语言边界 · 19 插件设计 Agent · 20 分层 Context · 21 Sidecar Runtime · 22 日志与 Session。
