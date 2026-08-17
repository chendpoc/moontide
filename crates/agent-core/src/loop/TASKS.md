# loop 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

`TASK` 是实现跟踪；**Review 批**是用户审查和提交的单位。公开 API 以 README 为准，算法与边界以 DESIGN 为准。

---

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|----|------|------|-----------|------|
| **R1** | 01–03 | Loop scaffold、ownership 接缝、terminal Turn | ~1250 行 | ☐ |
| **R2** | 04 | ToolRuntime、permission/approval、顺序 Tool round | ~650 行 | ☐ |
| **R3** | 05–06 | LLM retry、CancellationToken、cleanup 与 conformance | ~950 行 | ☐ |

R1 的 event/session 接缝与 loop terminal path 是一个完整的“单次无工具 Turn”心智模型；R2 只处理 Tool round；R3 处理错误恢复与取消。每批实现后运行 `just check`，停等用户 review；未经用户说 `commit` 不提交或进入下一批。

---

## TASK 明细

### TASK-loop-01: Loop 模块 scaffold 与公共契约

- **做什么：** 建立 `agent-core::loop` 模块并落地 README 已确认的 `AgentLoopInit`、`AgentLoop`、`TurnInput`、`TurnPolicy`、`ToolPermission`、`ToolApproval`、`ToolApprovalHandler` 与 `ToolRuntime` 公共边界。只建立 ownership/validation 所需结构，不实现完整 Turn 控制流。
- **依赖：** 无
- **范围：** `crates/agent-core/src/loop/`、`crates/agent-core/src/lib.rs`、根 `Cargo.toml` workspace dependency、`crates/agent-core/Cargo.toml`、`Cargo.lock`
- **预估 diff：** ~350 行
- **完成标准：** `cargo test -p agent-core`；模块可被同 crate 引用，公开签名与 README/DESIGN 一致；ToolRuntime key-set 完全匹配与 Ask-without-handler 拒绝测试通过。当前 workspace 尚无 `agent` crate，组合根接入不作为本批验收。
- **状态：** ☐

### TASK-loop-02: Event/Session ownership 接缝

- **做什么：** 汇总并落地 event/session 的 ownership 接缝：对应 `event/TASKS.md` 的 TASK-event-16/17 与 `session/TASKS.md` 的 TASK-session-12/13。EventDispatcher 每次 emit 借用 `&mut dyn CommitHandler`，PipelineRegistry 只持有 post-commit Hook；SessionStore 直接实现 mutable CommitHandler 并提供 `next_turn()`。
- **依赖：** TASK-loop-01；细任务依赖 TASK-event-16/17、TASK-session-12/13
- **范围：** `crates/agent-core/src/event/pipeline.rs`、`registry.rs`、`agent_recorder.rs`、`mod.rs`、`tests.rs`；`crates/agent-core/src/session/commit.rs`、`commit_handler.rs`、`store.rs`、`mod.rs`、`tests.rs`
- **预估 diff：** ~400 行
- **完成标准：** `cargo test -p agent-core`；committable 先 commit 后 Hook，observational 不 commit；Hook 错误不改变 dispatch；每次 emit 清理 transient TraceContext identity；next_turn empty/resume/overflow 通过；AgentEvent schema/recorder/storage/file writer 行为不变。
- **状态：** ☐

### TASK-loop-03: Terminal Turn 状态机

- **做什么：** 实现 AgentLoop 的单实例 ownership、preflight `context::materialize`、next turn 分配、TurnStarted/UserPromptCommitted、单 Step `compile → run_model_call_with_updates → AssistantFinalized → TurnEnded`。Terminal response 直接返回 ModelResponse，并拒绝错误的 ToolUse/ToolResult payload。
- **依赖：** TASK-loop-01、TASK-loop-02
- **范围：** `crates/agent-core/src/loop/agent_loop.rs`、`turn.rs`、`response.rs`、`mod.rs`、`tests.rs`
- **预估 diff：** ~500 行
- **完成标准：** terminal EndTurn/MaxTokens/Other 矩阵、preflight 不写入、UserMessage commit 后失败不回滚、AgentLoop 可运行下一 Turn 的测试通过。
- **状态：** ☐

### TASK-loop-04: ToolRuntime 与顺序 Tool round

- **做什么：** 实现 registry/permission key-set 校验、Ask approval 端口和 ToolUse round。全部 ToolCall 在副作用前记录，随后按模型顺序执行 resolve → validate → permission/approval → execute → result commit；unknown/invalid/denied/expected failure 与 sibling cleanup 全量配对。
- **依赖：** TASK-loop-03
- **范围：** `crates/agent-core/src/loop/tool_runtime.rs`、`agent_loop.rs`、`response.rs`、`turn.rs`、`tests.rs`
- **预估 diff：** ~650 行
- **完成标准：** ToolRuntime key-set/Ask handler 校验；ToolUse 多 call 顺序、approval Approved/Denied/Cancelled/Err、executor Err→OutcomeUnknown、remaining Parent、最后 Step ToolUse 闭合后报错的测试通过。
- **状态：** ☐

### TASK-loop-05: LLM retry 与 Turn cancellation

- **做什么：** 在同一 Step 内实现 Recoverable-only retry，默认初次后 3 次、固定 500ms/1s/2s backoff；用 `tokio_util::CancellationToken` 打断 LLM、backoff、approval 和 tool 等待，并按执行前/执行中语义生成 User/Parent/OutcomeUnknown 结果。
- **依赖：** TASK-loop-04
- **范围：** 根 `Cargo.toml` workspace dependency、`crates/agent-core/Cargo.toml`、`Cargo.lock`、`crates/agent-core/src/loop/retry.rs`、`cancellation.rs`、`turn.rs`、`tests.rs`
- **预估 diff：** ~550 行
- **完成标准：** `tokio-util = 0.7` 使用 `rt` feature；`max_llm_retries` 只接受 `0..=3`；retry 次数/Step/ModelRequest/llm_call_id、backoff cancellation、cleanup pairing、late cancel final commit wins 的行为测试通过。drop future 非正式取消作为文档契约，不伪造为可单测的 cleanup 保证。
- **状态：** ☐

### TASK-loop-06: Loop 跨模块 conformance 与收尾

- **做什么：** 补齐 Loop R1 的结构与行为守门，覆盖 Session → Turn → Step → Tool round 不变量、Hook 不影响决策、SessionStore 单 owner、无直接 `commit_item` 绕过，以及失败后可继续 Turn 的边界。同步模块文档状态与路线图。
- **依赖：** TASK-loop-05
- **范围：** `crates/agent-core/src/loop/tests.rs`、event/session/tools/llm conformance tests、`PROGRESS.md`、顶层 checklist
- **预估 diff：** ~400 行
- **完成标准：** `just check` 全绿；`git diff --check`；在 `loop/tests.rs` 与已有 context 结构测试同样使用 `include_str!` 守门：低层不反向依赖 loop，Loop 不 import agent/agent-tools/adapter；Hook 不改变 permission/retry/cancel 决策。
- **状态：** ☐

---

## 实现约束

- 不增加 Run、RunResult、TurnOutcome、TurnCancellation、TurnHandle 或 interrupt 公共抽象；
- 不将 Hook 重新变成 decision chain，不恢复 ObserveHandler；
- 不在 event/session 接缝批删除 AgentEvent、schema、recorder、storage 或 file writer；
- 不实现 scheduler 并发、tool retry、offload、compaction、follow-up/steering、subagent 或 OTel；
- 不修改 Agent Event 的 legacy `runId`/`runs/` schema 或 storage 路径；
- 每个新增测试前写场景、预期和不变量/副作用注释；
- 发现必须修改 README 的 `pub` 签名时，停止当前批次并回到架构对齐。
