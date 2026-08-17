# context — 内部设计

> **状态：** R1 设计已确认，实现与测试已通过 Review。
> **公开用法：** [`README.md`](README.md)

## 1. 职责与边界

`context` 负责把 Session Item Log 的有序事实记录 materialize 为模型可见的 `Vec<Message>`。它是只读、确定性的装配模块，不是 session store、compaction engine 或 provider adapter。

R1 只兑现以下能力：

1. 保持 session item 的事实顺序；
2. 将普通 user/assistant item 映射到协议 message；
3. 将连续 tool call/result item 聚合为模型协议要求的 assistant/user block message；
4. 校验 tool call/result 的身份配对；
5. 对 R1 尚不能解释的 `Compaction` 显式报错。

明确不做：session 写入、事实修复、tool 执行、provider wire 转换、compaction/prune/retrieval、manifest 或预算计算。

## 2. 模块结构

实现阶段保持窄目录：

```text
context/
├── README.md
├── DESIGN.md
├── TASKS.md
├── mod.rs
├── materialize.rs
└── tests.rs
```

- `mod.rs`：导出 crate 内部的 `materialize` 入口；
- `materialize.rs`：顺序遍历、分组、协议映射和配对校验；
- `tests.rs`：只验证 R1 语义和不变量。
- `TASKS.md`：记录 Review 批范围与完成状态。

不为 manifest、预算、compaction policy 或通用 message builder 预留文件。

## 3. 类型与签名

```rust
use anyhow::Result;

use crate::{
    llm::protocol::Message,
    session::SessionItem,
};

pub(crate) fn materialize(
    items: &[SessionItem],
) -> Result<Vec<Message>>;
```

实现还需要读取 session item 内的 canonical `ToolCall` / `ToolResult` 与 `ToolContent`，因此允许 import `crate::tools` 的只读类型。context 不定义第二套 call/result 结构，也不改变 session item 的所有权。

返回值只有 `Vec<Message>`，不携带 manifest、统计信息或 compaction plan。后续若需要额外产物，必须重新进行架构对齐，而不是在 R1 返回值上追加隐藏字段。

## 4. 核心算法

### 4.1 顺序扫描

按 `items` 原始顺序扫描，维护一个仅用于本次调用的 phase（idle / collecting calls / collecting results）和 pending tool call 集合：

1. `UserMessage`：若不存在未完成 tool call，产生一个 `Role::User` 文本消息；若有未完成 call，返回顺序错误。
2. `AssistantMessage`：若不存在未完成 tool call，产生一个 `Role::Assistant` 并复制原始 blocks；若有未完成 call，返回顺序错误。
3. 连续 `ToolCall`：在 `idle` 或 `collecting calls` phase 中合并为同一个 `Role::Assistant` 消息，每个 item 生成一个 `ContentBlock::ToolUse` 并登记 pending identity；处于 `collecting results` phase 时出现新的 `ToolCall`，返回顺序错误。这样同一 multi-call round 内可以有多个 call，但不会开启第二个未闭合 round。
4. 连续 `ToolResult`：从 `collecting calls` 切换到 `collecting results`，之后合并为同一个 `Role::User` 消息；每个 result 必须消费一个此前 pending 的 identity。同一 round 内可以按实际完成顺序到达，但一个 result 段必须耗尽上一段 call 的全部 pending entries，否则返回错误；pending 清空后回到 `idle`，下一段 ToolCall 才能开启新 round。
5. `CheckpointCreated`：忽略其 metadata，不生成 message，也不刷新当前 call/result 聚合缓冲；它对模型消息分组透明。
6. `Compaction`：R1 立即返回错误，不猜测 excluded ids、summary 或 token 字段的模型语义。

扫描结束时 pending 集合必须为空，否则返回 dangling tool call 错误。

连续段的聚合是语义要求，不是输出优化：provider message boundary 由 context 统一决定，不能让各个 llm adapter 再自行修补。

### 4.2 ToolCall 映射

```text
ToolCall.tool_use_id → ContentBlock::ToolUse.id
ToolCall.name        → ContentBlock::ToolUse.name
ToolCall.input       → ContentBlock::ToolUse.input
```

`input` 保持 JSON 值语义，只做必要 clone，不 stringify。

### 4.3 ToolResult 映射

```text
ToolResult.tool_use_id → ContentBlock::ToolResult.tool_use_id
ToolResult.content     → ContentBlock::ToolResult.content
```

内容转换为：

```text
ToolContent::Text(text) → ToolResultContent::Text(text)
ToolContent::Json(value) → ToolResultContent::Text(compact_json(value))
```

当前 `llm::protocol::ContentBlock::ToolResult` 没有 status/name 字段，因此 `ToolResultStatus` 和 name 不伪造为模型 block 字段。status 由 loop 决定是否继续、重试或终止；context 只负责验证 name 与 pending call identity 一致，并把 result content 交给模型。

### 4.4 配对校验

pending identity 至少包含 `tool_use_id` 与 call name。以下情况必须返回 `anyhow::Error`：

- 同一 pending 集合中重复的 `tool_use_id`；
- result 的 `tool_use_id` 没有对应 call；
- result name 与对应 call name 不一致；
- 一个 result 被重复消费；
- 扫描结束仍有 pending call；
- pending call 未结束时出现普通 user/assistant message；
- `Compaction` 出现在任何位置。

错误应包含 item 类型和相关 id/name，便于 turn 边界诊断；不吞错、不自动补全、不写回 session。

## 5. import 边界

允许：

```text
context ──► session       # 读取 SessionItem
context ──► llm::protocol # 生成 Message / ContentBlock
context ──► tools         # 读取 canonical ToolCall / ToolResult / ToolContent
```

禁止：

```text
context ──X──► model_input / loop / agent / cli
context ──X──► session store write APIs
context ──X──► provider adapter / HTTP / IPC
```

`loop` 是上层调用者；它负责调用顺序、permission/approval 和 tool 执行，并把 materialize 结果交给 `model_input::compile`。context 只要求下一次 model Step 前当前 round 的 call/result 已全部配对。Loop R1 已确认先记录全部 calls、顺序执行并全量配对；并发、资源 claim、deadline 与 tool retry 后置给 scheduler。`model_input` 不反向 import context。

## 6. 不变量

1. 输出 message 顺序与输入 item 的语义顺序一致；
2. 每个 `ToolCall` 最多生成一个 `ToolUse` block；
3. 每个 `ToolResult` 恰好消费一个同 id、同 name 的 pending call；
4. 连续 call/result 段各自只生成一个 message；
5. `CheckpointCreated` 不改变模型可见消息；
6. R1 不静默丢弃 `Compaction`；
7. 函数只读输入，不产生 session/event/file 副作用；
8. R1 保留 session 语义边界，连续同 role 的 `Message` 是合法输出；provider wire 的角色交替/合并由 `llm` adapter 负责；
9. 相同输入产生相同输出或相同错误类别，不依赖全局状态。

## 7. 边界情况

| 输入 | R1 行为 |
|---|---|
| 空 Session Item Log | 返回空 `Vec<Message>` |
| 空 user text | 保持 session 层已有校验边界；context 不替换文本 |
| 单个普通 assistant message | 原样复制其合法 blocks |
| 多个连续 tool calls | 一个 assistant tool-use message |
| 多个连续 tool results | 一个 user tool-result message |
| checkpoint 位于普通消息之间 | 忽略 checkpoint，保持其他消息顺序 |
| checkpoint 位于连续 call/result 段内部 | 不刷新聚合缓冲，保持同一 call/result message 分组 |
| compaction item | 返回错误 |
| tool result 先于 call | 返回未知 identity 错误 |
| call 无 result | 扫描结束返回 dangling call 错误 |
| 上一 call 段未闭合又出现新 call 段 | 返回顺序错误 |
| JSON tool content | 序列化为紧凑文本；序列化错误上抛 |

## 8. 决策记录

| 决策 | 理由 |
|---|---|
| 使用 `materialize` | 与项目术语一致，明确是 Session Item Log 到模型消息的唯一出口 |
| 只返回 `Vec<Message>` | R1 只解决消息语义，不提前锁定 manifest/预算/compaction 内部结构 |
| 连续 call/result 聚合 | provider message boundary 是 context 语义，不应分散到 adapter |
| checkpoint 忽略、compaction 报错 | checkpoint 只有 metadata；compaction 需要真实策略，不能静默丢失 |
| status 不写入 ToolResult block | 当前协议 block 没有 status 字段；控制语义归 loop，避免伪造 provider 字段 |
| 读借用而非消费 SessionItem | context 只读 materialize，不取得事实源所有权，也不制造写入路径 |
| Message 转换由 llm adapter 持有 | context 只生成 MoonTide canonical Message；provider wire 字段、角色合并和请求 envelope 属于 llm adapter |
| 不引入 context trait | R1 只有一个确定的纯函数边界，尚无独立实现或动态装配需求 |

## 9. 实现分期

### R1

- 实现 `materialize`；
- 覆盖普通消息、连续 tool call/result、checkpoint、compaction error 与配对错误；
- 保持 `pub(crate)` 入口和 `Vec<Message>` 返回值；
- 通过 `just check` 后停在用户 diff review。

### R2（未设计）

compaction、窗口、summary、retrieval、manifest 或预算若出现真实消费者，重新进行 context 架构对齐；不得从 R1 的私有 helper 直接演化出未经确认的公共契约。

## 10. 单测方向

实现阶段至少覆盖：

1. 普通 user/assistant item 的角色与内容映射；
2. 连续 tool calls 聚合为单个 assistant message；
3. 连续 tool results 聚合为单个 user message；
4. text/json tool content 的转换；
5. checkpoint 被忽略且不改变顺序；
6. compaction 明确返回错误；
7. 重复 call、未知 result、name mismatch、重复 result、dangling call 均被拒绝；
8. 上一 call 段未闭合时出现新 call 段被拒绝；
9. checkpoint 位于 call/result 段内部时不改变聚合分组；
10. 输入切片保持不变，materialize 不写 session 或其他外部状态；
11. import 边界通过静态检查或等价结构守门：context 只依赖 session、llm protocol 与 tools，不依赖 model_input、loop、agent 或 cli。

每个 `#[test]` 前必须写中文注释，明确测试场景、预期结果以及不变量/副作用约束；测试只验证 context 拥有的语义，不把 loop permission 或 llm preflight 混入本模块。
