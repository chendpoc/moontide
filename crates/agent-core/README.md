# agent-core 顶层设计与开发 checklist

> **性质：** 模块顶层设计 + 开发进度清单（design-first，逐模块推进）
> **状态：** 顶层设计已定；`llm` R1–R6 完成，`session` / `event` R1–R3 完成，`tools` 设计完成；其余模块按 `PROGRESS.md` 推进
> **关联：** [`docs/notes/runtime/agent-kernel-architecture.md`](../../docs/notes/runtime/agent-kernel-architecture.md)（§7 模块清单，本文是其落地）· [`docs/archive/notes/runtime/migration-plan.md`](../../docs/archive/notes/runtime/migration-plan.md)

## 0. 原则

1. **不依赖归档的 TypeScript draft 代码**（`packages/` 快照只作历史设计参考，Rust `agent-core` 以当前模块契约和实现为准）。
2. **按依赖顺序逐模块推进**：每个模块走「写设计文档 → 实现 → 单测通过 → 下一个」循环，不先写完 9 份再写代码。
3. **文档放模块源码目录**：`crates/agent-core/src/{mod}/README.md`（**对外使用说明**）+ `DESIGN.md`（**实现技术方案**）；可选 `TASKS.md`（分批实现）。
4. **按边界使用 trait**：`LLMProvider`、`ToolExecutor` 是核心能力端口；event pipeline 等需要独立实现的窄边界也可使用 trait。禁止为未来可能性或单实现逻辑提前抽象。

## 1. 依赖图（推进顺序）

```text
契约层（先定，供上层引用）
  1. llm         LLMProvider trait + ModelRequest/Response/Delta 类型
  2. session     item log 事实源（依赖 llm 的 message 类型）
  3. tools       ToolSpec + 单次执行边界（相对独立；验收 / offload 归 scheduler）
  4. permission  权限策略（独立）
  5. event       RunEvent 类型 + bus（契约提前定，loop 靠它 emit）

装配层（依赖契约层）
  6. prompt      system prompt 组装（依赖 tools 的 ToolSpec）
  7. context     materialize + compaction（依赖 session 的 item log）

编排层
  8. loop        turn 状态机（依赖 1–7 全部，最后串起）

后置
  9. scheduler   分诊 + fan-out + delegate + 排队（依赖 llm + tools）
```

## 2. 接口边界（谁 import 谁）

- **核心能力 trait**（确定存在多实现）：
  - `LLMProvider`：`stream(ModelRequest) -> Stream<Delta>`，实现 = cloud / 本地 daemon
  - `ToolExecutor`：`execute(ToolCall, ToolExecutionContext) -> ToolOutput`，实现 = 内置 / sidecar
- **其他窄边界**：event pipeline 的 `HookHandler` / `CommitHandler` / `ObserveHandler` 用于 callback 解耦；不把它们扩展成领域能力或全局 service trait。
- **其余模块是内部 mod**：高层 mod 依赖低层 mod，**低层不反向依赖高层**。
- **唯一写者**：`session` 是 item log 唯一写者；compaction 由 `context` 计算 `CompactionPlan`、由 loop 转发给 session 执行。
- **唯一出口**：`prompt.compile()` 是 Session → LLMRequest 的唯一出口；`context.materialize()` 是 item log → messages 的唯一出口。

## 3. 数据流（一次 Run 的完整链路）

```text
session.load()
  → context.materialize(item_log)          # item log → messages（含 compaction）
  → prompt.compile(system, tool_schema)    # Session → LLMRequest
  → llm.stream(request)                     # 流式返回
  → 解析响应（tool_call / text）
  → permission.check(tool_call)            # 授权判定
  → scheduler.admit(tool_call)             # 排队 / 串并行 / 取消
  → tools.execute_one(tool_call)           # 单次副作用
  → scheduler 处理验收 / offload / retry  # 多调用结果与 failover
  → event.emit(RunEvent)                   # hook → commit → observe
  → session commit handler                 # 唯一写者落盘
  → loop 判定 continue / steer / stop
```

## 4. 开发 checklist（状态总览）

图例：☐ 未开始 · ◐ 进行中 · ☑ 完成

| # | 模块 | 依赖 | 设计文档 | 实现 | 测试 | 备注 |
|---|---|---|---|---|---|---|
| 1 | `llm` | 无 | ☑ | ☑ | ☑ | R1–R6；[`src/llm/README.md`](src/llm/README.md) |
| 2 | `session` | llm 类型 | ☑ | ☑ | ☑ | R1–R3；item log 唯一写者 |
| 3 | `tools` | 无 | ☑ | ☐ | ☐ | ToolSpec + 单次执行边界；验收 / offload 归 scheduler |
| 4 | `permission` | 无 | ☐ | ☐ | ☐ | 授权策略 |
| 5 | `event` | 无 | ☑ | ☑ | ☑ | R1–R3；[`src/event/README.md`](src/event/README.md) |
| 6 | `prompt` | tools | ☐ | ☐ | ☐ | compile 唯一出口 |
| 7 | `context` | session | ☐ | ☐ | ☐ | materialize + compaction |
| 8 | `loop` | 1–7 全部 | ☐ | ☐ | ☐ | turn 状态机 |
| 9 | `scheduler` | llm + tools | ☐ | ☐ | ☐ | 后置 |

## 5. 每个模块的推进模板

每推进一个模块，产出三样：

1. `src/{mod}/README.md` — **对外使用说明**（调用者矩阵、API 速查、brief 原理图）
2. `src/{mod}/DESIGN.md` — **实现技术方案**（类型、算法、不变量、决策、单测方向）
3. `src/{mod}/` 实现 — 按 DESIGN 写代码
4. `src/{mod}/tests.rs` — 覆盖真实行为

**粒度：** permission / event 的 DESIGN 可较短；loop / context / session 需状态机图 + 完整决策记录。

## 6. 当前进度快照

- 顶层设计：☑（本文）
- 模块 1 `llm`：设计 ☑ · 实现 ☑ · 测试 ☑（R1–R6）
- 模块 2 `session`、5 `event`：设计 ☑ · 实现 ☑ · 测试 ☑（R1–R3）
- 模块 3 `tools`：设计 ☑ · 实现 ☐ · 测试 ☐
- 模块 4、6–9：☐ 未开始
- 当前推进：**tools R1**（纯类型、冻结 registry、单次调用规范化）

### 文档与集成入口

| 模块 | 对外使用（README） | 实现方案（DESIGN） |
|------|-------------------|-------------------|
| `session` | [`src/session/README.md`](src/session/README.md) | [`src/session/DESIGN.md`](src/session/DESIGN.md) |
| `event` | [`src/event/README.md`](src/event/README.md) | [`src/event/DESIGN.md`](src/event/DESIGN.md) |
| `llm` | [`src/llm/README.md`](src/llm/README.md) | [`src/llm/DESIGN.md`](src/llm/DESIGN.md) |
| `tools` | [`src/tools/README.md`](src/tools/README.md) | [`src/tools/DESIGN.md`](src/tools/DESIGN.md) |

**原则：** `loop` 只 `emit`；`session` 只经 commit 阶段写盘；`agent` 装配 Registry；`cli` 只读观测。
