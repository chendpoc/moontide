# agent-core 顶层设计与开发 checklist

> **性质：** 模块顶层设计 + 开发进度清单（design-first，逐模块推进）
> **状态：** 顶层设计已定；模块 1–7 已实现并通过测试；`scheduler` 暂缓，当前转入 Desktop Shell 宿主能力建设
> **设计权威：** [`DESIGN.md`](DESIGN.md)（8 模块合并实现方案）· **系统摘要：** [`crates/docs/agent-core.md`](../docs/agent-core.md)

## 0. 原则

1. **不依赖归档的 TypeScript draft 代码**（`packages/` 快照只作历史设计参考，Rust `agent-core` 以当前模块契约和实现为准）。
2. **按依赖顺序逐模块推进**：每个模块走「写设计文档 → 实现 → 单测通过 → 下一个」循环，不先写完 8 份再写代码。
3. **文档分层：** crate 级 [`DESIGN.md`](DESIGN.md) 为实现权威；`src/{mod}/README.md` 为短集成说明（~30–60 行）。开放实现任务跟踪 GitHub Issues。
4. **按边界使用 trait**：`LLMProvider`、`ToolExecutor` 是核心能力端口；event pipeline 等需要独立实现的窄边界也可使用 trait。禁止为未来可能性或单实现逻辑提前抽象。

## 1. 依赖图（推进顺序）

```text
契约层（先定，供上层引用）
  1. llm         LLMProvider trait + ModelRequest/Response/Delta 类型
  2. session     Session Item Log 事实源（依赖 llm/tools 契约；实现 event commit seam）
  3. tools       ToolSpec + 单次执行边界（相对独立；验收 / offload 归 scheduler）
  4. event       TurnEvent 类型 + dispatch（tool TurnEvent 直接包装 tools call/result）

装配层（依赖契约层）
  5. model_input 纯组装 ModelRequest（依赖 tools + llm protocol）
  6. context     materialize + compaction（依赖 Session Item Log、llm protocol 与 tools payload）

编排层
  7. loop        turn 状态机（依赖 1–6 全部，持有组合根注入的 ToolPermissionMap）

后置
  8. scheduler   分诊 + fan-out + delegate + 排队（依赖 llm + tools）
```

## 2. 接口边界（谁 import 谁）

- **核心能力 trait**（确定存在多实现）：
  - `LLMProvider`：`stream(ModelRequest) -> Stream<Delta>`，实现 = cloud / 本地 daemon
  - `ToolExecutor`：`execute(&ToolCall, working_dir) -> ToolResult`，实现 = 内置 / sidecar
- **其他窄边界**：event 的 mutable `CommitHandler` 隔离事实提交，post-commit `HookHandler` 隔离 Agent Event/UI/sidecar/metrics callback。Hook fail-open，不参与 permission、取消、retry 或 loop 决策。
- **其余模块是内部 mod**：高层 mod 依赖低层 mod，**低层不反向依赖高层**。
- **唯一写者**：`session` 是 Session Item Log 唯一写者；未来 compaction 策略由 `context` 计算、由 loop 转发给 session 执行，具体计划类型尚未确认。tool item 直接包装 tools 的 `ToolCall` / `ToolResult`，session 只持久化，不决定状态。
- **唯一出口**：`model_input::compile()` 是 `ModelRequest` 的唯一运行时构造出口；`context::materialize()` 是 Session Item Log → model-visible messages 的唯一出口。

## 3. 数据流（一次 Turn 的完整链路）

```text
agent create/load/fork SessionStore
  → move into AgentLoopInit
  → AgentLoop::turn(input, CancellationToken)
      → materialize existing log preflight
      → next_turn + commit UserMessage
      → Step 0..max_steps:
          materialize → compile → LLM attempt(s)
          → terminal ModelResponse: commit assistant + return
          → ToolUse: commit all ToolCall before side effects
              → resolve → validate → permission/approval → execute
              → commit every ToolResult
              → next Step
```

执行层级固定为 Session → Turn → Step → Tool round，没有领域 Run。LLM retry 是同一 Step 内的 attempt；默认初次后重试 3 次。Turn cancellation 直接使用 CancellationToken。R1 顺序执行同一 round 的 calls；scheduler 后置接管资源调度、并发、tool retry 与 offload，不插入单次 tools 门禁。

## 4. 开发 checklist（状态总览）

图例：☐ 未开始 · ◐ 进行中 · ☑ 完成

| # | 模块 | 依赖 | 设计 | 实现 | 测试 | 备注 |
|---|---|---|---|---|---|---|
| 1 | `llm` | 无 | ☑ | ☑ | ☑ | R1–R6；[`src/llm/README.md`](src/llm/README.md) |
| 2 | `session` | llm + tools + event seam | ☑ | ☑ | ☑ | R1–R3；R4 开放项 [#27](https://github.com/chendpoc/moontide/issues/27) |
| 3 | `tools` | 无 | ☑ | ☑ | ☑ | RB1–RB2 |
| 4 | `event` | llm + tools 契约 | ☑ | ☑ | ☑ | sidecar 开放项 [#28](https://github.com/chendpoc/moontide/issues/28) |
| 5 | `model_input` | tools + llm protocol | ☑ | ☑ | ☑ | R1 完成 |
| 6 | `context` | session + llm protocol + tools | ☑ | ☑ | ☑ | R1 materialize 完成 |
| 7 | `loop` | 1–6 全部 | ☑ | ☑ | ☑ | R1–R3 完成 |
| 8 | `scheduler` | llm + tools | ☐ | ☐ | ☐ | 暂缓 |

## 5. 文档索引

| 模块 | 集成说明（README） | 实现方案（DESIGN 锚点） |
|------|-------------------|------------------------|
| `llm` | [`src/llm/README.md`](src/llm/README.md) | [`DESIGN.md#llm`](DESIGN.md#llm) |
| `session` | [`src/session/README.md`](src/session/README.md) | [`DESIGN.md#session`](DESIGN.md#session) |
| `tools` | [`src/tools/README.md`](src/tools/README.md) | [`DESIGN.md#tools`](DESIGN.md#tools) |
| `event` | [`src/event/README.md`](src/event/README.md) | [`DESIGN.md#event`](DESIGN.md#event) |
| `model_input` | [`src/model_input/README.md`](src/model_input/README.md) | [`DESIGN.md#model_input`](DESIGN.md#model_input) |
| `context` | [`src/context/README.md`](src/context/README.md) | [`DESIGN.md#context`](DESIGN.md#context) |
| `loop` | [`src/loop/README.md`](src/loop/README.md) | [`DESIGN.md#loop`](DESIGN.md#loop) |
| `scheduler` | — | [`DESIGN.md#scheduler`](DESIGN.md#scheduler) |

**原则：** AgentLoop 独占 SessionStore；运行时写入只经 `event.emit(&mut session, TurnEvent)`；Hook post-commit 且 fail-open；`agent` 只装配，`cli` 通过 agent 调 Turn。
