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
| `crates/agent-core/src/loop/README.md` / `DESIGN.md` | Loop R1 对外契约与状态机、ownership、retry/cancel/tool round 技术设计 |
| `docs/archive/spec/context-composer.md` | TypeScript 历史 Context Composer，仅供追溯 |
| `docs/notes/runtime/agent-kernel-architecture.md` | 内核架构收敛：crate 判据、多语言 trade-off、TurnEvent dispatch、决策清单 |

## 关键设计决策速查

1. **三种语义、默认两条路径**：Session Item Log（可重放事实）· Progress（实时 frontend 消费）· Agent Event Log / logger（按 policy 启用的可丢弃诊断）。判断标准：模型可见 / resume 要知道 → Session Item Log；只为实时展示 → Progress；需要诊断持久化时启用 Agent Event Log。
2. **session 四不变量**：`seq == log.len()`、先校验后冻结、模型可见先入 log、header 外置。
3. **扩展边界**：sidecar（进程间）+ MCP（JSON-RPC over stdio）；隔离靠 OS 进程边界强制，非约定。
4. **runtime 成本**：共享 runtime 默认（O(版本数)），embedded（打包单文件）例外（O(N) 重复）。
5. **双写原则**：生命周期事实双写——session log 记「发生了什么」，logger 记「怎么发生」。
6. **错误建模**：取消原因（user/parent/hook/disposed）与请求失败（可恢复/不可恢复）是两个正交枚举；steer 是独立通道。
7. **llm 分层（2026-08-14）**：`llm/protocol/` = MoonTide 协议（block 模型）；`LLMProvider` = 唯一 trait；`AdapterFamily` = wire 协议族（与 preset 解耦）；每个 family 必须配对 `adapter/{family}/` + `normalize/{family}/`（族内 tool/thinking/stream）；跨族逻辑仅 `normalize/common.rs`；preset/路由在 `agent/`，不在 llm；首版 DeepSeek 默认 `OpenAiChatCompletions`。用法 [`llm/README.md`](../../../crates/agent-core/src/llm/README.md)；实现 [`llm/DESIGN.md`](../../../crates/agent-core/src/llm/DESIGN.md)。
8. **llm 流式消费（2026-08-15）**：`ModelStreamEvent`（含 `block_index`）由 adapter 产出；`ModelResponseBuilder` 唯一 fold → `ModelResponseSnapshot`（含 `pending`）/ `ModelResponse`；loop 经 `run_model_call*`（禁止直接 match 事件）；`Finished` 非全文 Completed；lifecycle 归 `TurnEvent`。
9. **实现子流程**：README ☑ → [`batch-implement`](batch-implement/SKILL.md)——Review 批合并交付；需求使用 `feat/<demand>/base` 作为集成线，批次使用 `feat/<demand>/r1`、`r2` 等 stacked PR；`r1→base`，`r{n≥2}→r{n−1}`，上一批合入 base 后 rebase 整理；需求完成后 `feat/<demand>/base→main`。发布冻结才使用 `release/<demand>-v1.0`，不使用 `feat/<demand>-v1.0` 作为普通开发分支。

> model_input 最终设计（2026-08-16）：模块名从 `prompt` 收敛为 `model_input`，作为 `ModelRequest` 唯一运行时构造出口；公开 `SystemPrompt`、`ModelRequestConfig` 与 infallible `compile(config, system_prompt, messages, tool_registry)`。`SystemPrompt` 由 `agent` 每 user turn 解析一次并在 turn 内稳定；`compile` 每 model step 调用。messages 由 `context::materialize` 原样交付，compaction/prune/retrieval/manifest 归 context；tool schemas 从冻结 registry 稳定、精确映射；provider 兼容和请求 preflight 仍归 llm。

> context R1 契约（2026-08-17）：`pub(crate) fn materialize(items: &[SessionItem]) -> anyhow::Result<Vec<Message>>` 是 Session Item Log 到 model-visible messages 的唯一出口。`UserMessage` / `AssistantMessage` 直接映射；连续 `ToolCall` 聚合为一个 assistant tool-use message；连续 `ToolResult` 聚合为一个 user tool-result message；`CheckpointCreated` 只作 metadata 忽略且不打断聚合；`Compaction` 在 R1 显式返回错误。materialize 只读，不写 session、不执行 compaction/prune/retrieval、不引入 manifest、预算对象或 token counter trait；tool call/result 必须按 `tool_use_id`（及对应 name）成对，否则返回错误。一个 call 段未闭合前不得开启下一 call 段。`ToolResultStatus` 保留在 session/loop 控制语义中，不改写为 provider message 字段。

> tool-call round closure（2026-08-17）：一个连续 `ToolCall` 段是一次 round；下一次 model step 前，round 内每个 call 都必须存在配对的 `ToolResult`。context 只验证 Session Item Log 中的 round 是否闭合，不预设并发、deadline、join、timeout 或状态映射；这些执行政策留到 `loop` / `scheduler` 架构对齐。

> Message transform ownership（2026-08-17）：`Message` 是 MoonTide provider-neutral 的 canonical model-input record，不是 provider wire payload，也不是持久化 SessionItem。`context` 只负责 `SessionItem → Message`；`llm::adapter` 负责完整 `ModelRequest → provider wire request`，其中包含 Message、system、tools 与 request config 的转换。R1 不在 `Message` 上公开通用 `Transform<Target>` trait；如某 adapter 需要方法语法，只能在 adapter 内使用私有 extension trait。

> loop 生命周期收敛（2026-08-17）：删除无独立执行语义的 Run 层；执行层级固定为 Session → Turn → Step → Tool round。`RunEvent` 改为 `TurnEvent`，删除 `RunStarted` / `RunEnded`。Hook、Agent Event、derive、recorder、schema、storage 与 file writer 保持不变；其中 `runId` / `run_id` / `runs/` 仅是 legacy Agent Event 分区契约，不代表 Run 实体，待 observability 真正接入时再迁移设计。

> loop R1 ownership（2026-08-17）：AgentLoop 长期独占 non-Clone SessionStore，`turn(&mut self)` 串行化同实例；R1 不增加 OS Session lease，两个独立 AgentLoop 同时 load 同一 session 属于不支持用法。agent 通过一次性 `AgentLoopInit { session, provider, tools, events }` 转移所有权；EventDispatcher 不再长期拥有 commit handler，每次 emit 短借 `&mut SessionStore`。SessionStore 直接实现 mutable CommitHandler，现有 Mutex-based SessionCommitHandler 在实现批移除。

> loop R1 Turn/Step（2026-08-17）：`turn(TurnInput, CancellationToken) -> anyhow::Result<ModelResponse>`，不增加 RunResult/TurnOutcome。TurnInput 含 text、ModelRequestConfig、SystemPrompt、TurnPolicy；max_steps 必须大于 0，默认 max_llm_retries=3。新 UserMessage 前先 materialize 已有 facts；next turn 由 SessionStore 只读计算，UserMessage commit 后编号永久消费，错误不回滚。Step 从 0 开始；retry attempt 不增加 Step、不重新 compile，每次使用新 llm_call_id；最后允许 Step 返回 ToolUse 时先闭合 round，再返回 step-limit error。

> loop R1 response/tool round（2026-08-17）：ToolUse response 必须至少一个 ToolUse；非 tool blocks 先作为 AssistantFinalized 提交，全部 ToolCall 在任何副作用前按模型顺序 commit，然后 R1 顺序执行 resolve → validate → permission/approval → execute → result commit。每 call 恰好一个 result。unknown/invalid/denied 为模型可见结果；approval Cancelled 为当前 User/剩余 Parent；approval handler Err 为当前 Disposed/剩余 Parent；executor Err 或执行中取消为当前 OutcomeUnknown/剩余 Parent，全部 commit 后传播。EndTurn/MaxTokens/Other 禁止 ToolUse，提交可用 assistant blocks并返回原 ModelResponse；模型产生 ToolResult 非法。

> loop R1 retry/cancel/hook（2026-08-17）：只重试 LlmError Recoverable，默认初次后 3 次，固定 cancellation-aware backoff 500ms/1s/2s；tool/session/hook 不自动 retry。Turn 直接使用 tokio_util CancellationToken，不建立 TurnCancellation/TurnHandle/interrupt 公共抽象；drop future 不是正式取消，调用方 cancel 后继续 await cleanup。Hook 的本质是 post-commit、fail-open 的扩展 callback，只读 TurnEvent/TraceContext，不能 Block/Approve/Cancel/Retry；原 ObserveHandler 合并为 Hook，Agent Event derive/recorder/schema 归 event，Agent Event queue/worker/file persistence 归 `agent::log`，按 `DiagnosticPersistence` 启用。默认仍是 Session + Progress；follow-up/steering、多 Turn Run、scheduler 并发、tool retry、compaction、subagent、OTel 与 lease 后置。

> Desktop v0.1 范围（2026-08-18，用户确认）：下一阶段采用单窗口、单活跃 Session、Turn 串行；Desktop 直接复用 `agent`，不复制 AgentLoop，不通过 CLI 子进程接入。P0 包含 assistant 流式 snapshot、宿主 UI 事件、approval、CancellationToken 清理、运行状态、Session 恢复、错误展示、配置与密钥管理；多 Session 并发、后台队列、scheduler、多 Agent、sidecar 和跨进程 daemon 后置。

> Desktop D1 宿主契约（2026-08-20）：Desktop 独立为产品 crate，依赖 `agent` 组合根。`DesktopHostActor` 独占一个 `agent::Agent`；边界为单窗口、单活跃 Session、单活跃 Turn、同进程、Turn 串行。UI 只经 `DesktopHostHandle` 发送 submit/cancel/approval/shutdown command，经单一有序 `EventBuffer` 暴露的 `DesktopEventStream` 接收事件；高频 assistant snapshot 按 `(turn, llm_call_id)` 合并，approval、终态、错误和 shutdown 保持可见，丢失后由 `DesktopSnapshot` 建立新 resync 基线，不提供旧 seq replay。RenderState 属于 UI，按完整 `AssistantResponseSnapshot` 替换 draft，`AssistantFinalized` 后才写入 conversation projection；`agent-core::session` 提供只读 SessionQuery，`agent` re-export facade，Desktop 不解析 JSONL。多 Session、scheduler、daemon、IPC、server、sidecar 后置。

> Desktop process architecture（2026-08-20，2026-08-21 重规划）：目标拓扑为 Web frontend/WebView → Tauri Rust desktop shell → versioned `desktop::protocol` → `moontide-agent-host` runtime process。Web frontend 只拥有 RenderState、用户 intent、输入 draft 和 UI 偏好；Tauri shell 拥有 window、bridge、protocol client 和连接状态；Agent Host 独占 `Agent`、SessionStore、ApprovalBroker、Progress/diagnostic workers 和 runtime lifecycle。`agent-core::TurnEvent → agent::ProgressEvent → DesktopProtocolEvent → frontend RenderState` 是三层事件语义；最终协议不暴露 Tauri、前端框架或 Agent runtime ownership / implementation 类型。由于 WebView 是非 Rust consumer，D2 replan 必须先冻结独立 wire DTO 并提供 TypeScript types/fixtures conformance，不能继续把 in-process canonical value types 当作前端 contract。AgentLoop 仍是 Agent Host 内的 Tokio task，subagent 先是逻辑 runtime/actor；tool subprocess 只用于权限/隔离需要；daemon 是未来独立生命周期的 sibling/service，不是 Agent 子进程。不实现 daemon、multi-agent 或 AgentLoop worker process，直到对应消费者明确出现。完整设计见 [`crates/docs/desktop-process-architecture.md`](../../../crates/docs/desktop-process-architecture.md)。

> Desktop UI interaction baseline（2026-08-19）：已提出“对话中心的轻量 Workbench”作为 v0.1 候选：Conversation 为默认主区域，左侧 Session Rail 负责新建/恢复/切换，右侧 Inspector 默认收起并承载 Tool、Approval、Thinking、Diagnostics 详情；单窗口、单活跃 Session、单活跃 Turn，不提供隐式队列。Composer 的 Send/Stop、assistant draft 替换、Tool card 状态、Approval decision、cancel cleanup、错误 notice、resync、Session resume、settings modal、快捷键和 light/dark 可访问性基线见 `crates/desktop/UI-INTERACTION.md`；该 baseline 在 D3 前完成 review，视觉细节和多窗口/多 Agent 面板后置。

> Desktop UI framework selection（2026-08-21）：用户撤回 Iced，Desktop v0.1 改为 Tauri 2 + 轻量 Web 前端，推荐 Svelte + TypeScript。Tauri 只属于 Desktop shell，Host、`agent`、`agent-core` 和 `desktop::protocol` 不依赖 Tauri 或前端框架；前端以 protocol client → RenderState → component view 组织，不引入大型状态管理框架。Iced 现有未提交 shell 只作迁移残留，Tauri vertical slice 通过后删除。

> Desktop UI resource direction（2026-08-21）：用户要求专业 Agent 产品保持资源与能力边界克制，同时确认采用 Tauri。Electron/内置 Chromium 仍排除；Tauri 使用 system WebView 但引入 HTML/CSS/JavaScript、WebView 和 frontend/backend invoke。固定内存/磁盘数字仍需同一 Tauri + 前端实现的可复现实测，不写入未经验证的事实；D3 进入 system WebView 启动、文本渲染、bridge、资源、关闭清理和 capability 最小化验收。

> Progress R2 事件契约（2026-08-19，用户确认）：所有 LLM attempt 都发一次 `LlmCallEnded`，使用 typed `LlmCallOutcome` 表达成功、请求失败、无效响应或取消；每个成功 call 发一次 `AssistantFinalized`，tool-only response 使用空 marker 关闭运行时 draft，但空 marker 不写入 Session Item Log。`ToolCall` / `ToolResult` 以完整 canonical payload 传播，状态使用 enum；R2 删除独立 `Thinking` progress event，frontend 从全量 `AssistantResponseSnapshot` 渲染 thinking。`ProgressHook` 只在 post-commit 后以 bounded `try_send` 入队，ProgressWorker 异步串行调用 observer；snapshot 可 coalesce，生命周期事件保持顺序，队列溢出触发 `dropped_events` / resync 但不阻塞 AgentLoop；ProgressWorker 不提供无 runtime fallback，Agent create/resume/reload 要求 Tokio runtime。普通 plugin 只作 post-commit observer，before-event 决策使用 permission/approval 等显式 API。

> Agent Event Log 收敛（2026-08-19，用户确认并完成 R3）：默认运行路径仍是 `TurnEvent dispatch → Session Item Log + Progress`；`agent-core::event` 只拥有 TurnEvent、derive、AgentEventRecord 和 recorder port；`agent::log` 负责按 `DiagnosticPersistence` 装配 bounded queue、Tokio worker 和 buffered JSONL writer。默认 `SessionPersistence::Items + DiagnosticPersistence::Off` 不注册 Hook、不启动 worker、不创建 active JSONL；`Errors` 仅记录失败 LLM/tool 结果，`Normal` 过滤高频 snapshot，`Debug` 保留全部 derived records。queue 满与 worker/file 错误通过 status 暴露，诊断链路 fail-open；不引入 `dropped_bytes` 或 byte-budget queue。

> loop TASK review（2026-08-17）：`TraceContext` 的 `session_item_id`、`tool_use_id`、`llm_call_id` 每次 `emit` 开始清理，再从当前 event 填充；`run_id` / `session_id` 保留为稳定上下文。`max_llm_retries` 收敛为 `0..=3`，默认 3，超过范围拒绝。

> scheduler scope（2026-08-17）：当前不实现 scheduler，也不建立 scheduler README/DESIGN。Loop 已覆盖单 AgentLoop、顺序 Tool round、retry/cancel/cleanup；只有真实的并发 ToolCall、资源冲突、共享模型 daemon 队列、多 Agent fairness、tool retry 或 offload/failover 消费者出现后，才重新进行 scheduler 架构对齐。旧架构笔记中的模型分诊、fan-out、delegate、failover、fairness 先保留为候选方向，不作为当前契约。

> agent/cli 初步可用版（2026-08-17）：Loop 完成后优先构建 `agent` 组合根与 `cli` 纯壳，不推进 scheduler。`agent` 公开 `AgentConfig`、`Agent::create/resume/turn`，拥有 provider、SessionStore、ToolRuntime、EventDispatcher 和 AgentLoop；`cli` 只解析参数/env、运行 one-shot/REPL、approval、render final response。AgentConfig 接收显式解析值，agent 不读环境变量；Harness System Prompt 与 cwd ancestor 的 Project `AGENTS.md` 由 agent 合成，UserMessage 保持独立。默认工具 read/find/grep Allow，write/edit/bash Ask。

> tools 最终设计（2026-08-16）：公开类型使用构造器与只读访问器；registry 构造即冻结、稳定排序并编译缓存 input validator，非法 schema 阻止整个 registry；使用关闭 default features 的 `jsonschema` 0.49，固定 Draft 2020-12 并禁用 HTTP/file resolver；registry 仅以 crate 内部 `validate_input(tool, call) -> Result<(), String>` 暴露预期参数错误，`Tool::execute` 隐藏 executor、直接返回 `ToolResult`，并校验结果 identity 与 executor 可拥有的 status。执行前只保留 input validation 与 permission check，不引入阶段型 call、ToolAdmission 或 scheduler admission；R1 只保留 `input_schema`，`output_schema` 后置；tools 保留 canonical schema，LLM adapter 默认透传且只对已确认关键词异常做小型显式转换。调用生命周期只使用 `ToolCall` / `ToolResult` 两个结构体；不存在 `ToolOutput` / invocation / outcome 中间模型。结果载荷为带显式 serde tag 的 `ToolContent::Text | Json`；executor 使用 `succeeded` / `failed` / `outcome_unknown` 构造结果，loop 通过 crate 内 `with_status` 生成 pipeline-owned 状态。基础设施错误走 `anyhow::Result`，loop 先提交 `OutcomeUnknown` 配对结果再传播原错误。executor 只读借用 `&ToolCall` 并显式接收 `working_dir: &Path`；session/turn 身份留在高层。permission 不进入 `ToolSpec`，组合根维护 `ToolPermissionMap<tool_name, Allow | Ask>`，完整拒绝顺序归 loop 集成测试；scheduler 的资源、并发、重试和 offload/failover 仍在后置模块。

> Tool Library 边界（2026-08-16）：`agent-core::tools` 保留单次调用 runtime contract，不合入具体工具库；独立 `agent-tools` crate 按域存放 bash/grep/web_fetch 等第一方 spec/executor，公开 `ToolDefinition { name + build }` catalog；agent preset 声明 tool names，bootstrap build 为 `Vec<Tool>` 后冻结 `ToolRegistry`。依赖只能是 `agent-tools → agent-core`，不引入 `ToolLibrary` struct、外部 manifest、通用 build context 或第二套 registry。

## TODO 关联条目

`TODO.md`：16 内核 Rust 化（当前主轨）· 17 跨语言契约 · 18 多语言边界 · 19 插件设计 Agent · 20 分层 Context · 21 Sidecar Runtime · 22 日志与 Session。
