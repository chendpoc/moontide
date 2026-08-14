# moontide-agent-core 顶层设计与开发 checklist

> **性质：** 模块顶层设计 + 开发进度清单（design-first，逐模块推进）
> **状态：** 顶层设计已定；9 个模块全部未开始（设计文档 / 实现 / 测试均待做）
> **关联：** [`docs/notes/runtime/agent-kernel-architecture.md`](../../docs/notes/runtime/agent-kernel-architecture.md)（§7 模块清单，本文是其落地）· [`docs/notes/runtime/migration-plan.md`](../../docs/notes/runtime/migration-plan.md)

## 0. 原则

1. **不依赖当前 `crates/` 的 draft 代码**（`moontide-agent`/`composer`/`llm`/`session`/`tools`/`observability`/`protocol` 等是初版草稿，只作设计参考，**不 import、不复用其实现**）。
2. **按依赖顺序逐模块推进**：每个模块走「写设计文档 → 实现 → 单测通过 → 下一个」循环，不先写完 9 份再写代码。
3. **文档放模块源码目录**：`crates/moontide-agent-core/src/{mod}/README.md`（设计 + 伪代码 + 决策记录）。
4. **trait 只留给两个**：`LLMProvider`、`ToolExecutor`；其余模块用具体类型 + 策略模式，不上 trait（对齐 agent-kernel-architecture §6 纪律）。

## 1. 依赖图（推进顺序）

```text
契约层（先定，供上层引用）
  1. llm         LLMProvider trait + ModelRequest/Response/Delta 类型
  2. session     item log 事实源（依赖 llm 的 message 类型）
  3. tools       ToolSpec + 验收网关（相对独立）
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

- **只有两个 trait**（多实现确定存在）：
  - `LLMProvider`：`stream(ModelRequest) -> Stream<Delta>`，实现 = cloud / 本地 daemon
  - `ToolExecutor`：`execute(ToolCall) -> ToolResult`，实现 = 内置 / sidecar
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
  → tools.execute(tool_call)               # 执行
  → tools.verify(result)                   # 验收网关，失败则 failover
  → session.append(new_item)               # 唯一写者落盘
  → event.publish(RunEvent)                # 广播（UI/持久化/bridge）
  → loop 判定 continue / steer / stop
```

## 4. 开发 checklist（状态总览）

图例：☐ 未开始 · ◐ 进行中 · ☑ 完成

| # | 模块 | 依赖 | 设计文档 | 实现 | 测试 | 备注 |
|---|---|---|---|---|---|---|
| 1 | `llm` | 无 | ☑ | ◐ | ☐ | [`src/llm/README.md`](src/llm/README.md) |
| 2 | `session` | llm 类型 | ☐ | ☐ | ☐ | item log 唯一写者 |
| 3 | `tools` | 无 | ☐ | ☐ | ☐ | ToolSpec + 验收网关 |
| 4 | `permission` | 无 | ☐ | ☐ | ☐ | 授权策略 |
| 5 | `event` | 无 | ☐ | ☐ | ☐ | RunEvent + bus + bridge |
| 6 | `prompt` | tools | ☐ | ☐ | ☐ | compile 唯一出口 |
| 7 | `context` | session | ☐ | ☐ | ☐ | materialize + compaction |
| 8 | `loop` | 1–7 全部 | ☐ | ☐ | ☐ | turn 状态机 |
| 9 | `scheduler` | llm + tools | ☐ | ☐ | ☐ | 后置 |

## 5. 每个模块的推进模板

每推进一个模块，产出三样：

1. `src/{mod}/README.md`——设计文档，含：
   - 职责一句话
   - 关键类型/接口（Rust 伪代码）
   - 不变量（哪些状态非法）
   - 决策记录（为什么这么设计，1–3 条）
   - 边界情况
2. `src/{mod}/` 实现——按文档写代码。
3. `src/{mod}/tests.rs`（或 `tests/` 单测）——覆盖真实行为，不写 trivial assert。

**粒度对齐复杂度**：permission / event 半页文档即可；loop / context / session 需状态机图 + 完整决策记录。

## 6. 当前进度快照

- 顶层设计：☑（本文）
- 模块 1 `llm`：设计 ☑ · 实现 ◐ · 测试 ☐
- 模块 2–9：☐ 未开始
- 当前推进：**模块 1 `llm` 实现**（protocol → provider → openai_chat adapter/normalize）
