# context

> **对内使用说明** — `loop` 在 crate 内调用 `context::materialize` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)
> **状态：** R1 `materialize` 已实现、测试并通过 Review。

## 这是什么

`context` 是 Session Item Log 到模型可见消息的唯一 materialize 边界。它读取 session 的事实记录，按模型协议组织消息，不修改事实源，也不决定下一次调用是否压缩历史。

```text
SessionStore.items() ──read-only──► context::materialize
                                         │
                                         ▼
                                  Vec<Message>
                                         │
                                         ▼
                              model_input::compile
```

## 模块 API

```rust
pub(crate) fn materialize(
    items: &[SessionItem],
) -> anyhow::Result<Vec<Message>>;
```

`materialize` 是 crate 内部的唯一运行时入口：

- 输入是已经加载的 `SessionItem` 切片；
- 输出是 provider-neutral 的 `llm::protocol::Message` 列表；
- 输入按借用读取，函数不写 session、不创建新 item；
- 非法的 tool call/result 配对或 R1 不支持的 compaction 返回错误。

## 谁该用什么

| 调用者 | 可以做什么 | 不应做什么 |
|---|---|---|
| `loop` | 在每个 model step 前调用 `materialize`，把结果交给 `model_input::compile` | 自己遍历 `SessionItem` 组装消息 |
| `session` | 提供只读 `SessionItem` 序列 | 反向调用 context 或实现模型消息语义 |
| `model_input` | 消费 `Vec<Message>` 并组装 `ModelRequest` | 再次 materialize、裁剪或压缩消息 |
| `agent` / `cli` | 通过上层运行链路使用结果 | 直接写 context 状态或绕过 `loop` |

## R1 映射语义

| Session item | model-visible message |
|---|---|
| `UserMessage` | 一个 `Role::User` 的文本消息 |
| `AssistantMessage` | 一个 `Role::Assistant`，保留原始 blocks |
| 连续 `ToolCall` | 一个 `Role::Assistant`，每个 call 是一个 `ToolUse` block |
| 连续 `ToolResult` | 一个 `Role::User`，每个 result 是一个 `ToolResult` block |
| `CheckpointCreated` | 忽略；它是 session metadata，不是模型内容 |
| `Compaction` | R1 返回错误；不静默丢弃其语义 |

工具结果内容只做协议所需的轻量转换：文本保持文本，JSON 序列化为紧凑文本。`ToolResultStatus` 仍由 session/loop 保留为控制语义，不被伪造为 `ContentBlock::ToolResult` 的额外字段。

## 调用示例

连续工具交互保持模型所需的消息边界：

```text
UserMessage("检查文件")
ToolCall(call-a)
ToolCall(call-b)
ToolResult(call-a)
ToolResult(call-b)
```

materialize 后为：

```text
User("检查文件")
Assistant([ToolUse(call-a), ToolUse(call-b)])
User([ToolResult(call-a), ToolResult(call-b)])
```

`CheckpointCreated` 是透明 metadata，不打断 round：`ToolCall(A), CheckpointCreated, ToolCall(B)` 仍属于同一个 assistant tool-use message。

结果必须匹配此前仍 pending 的 `tool_use_id`，且 call/result 的 tool name 一致；同一 round 内 result 可以按实际完成顺序到达，但必须全部闭合。重复 call、未知 result、重复 result、name 不一致或末尾仍有 pending call 都是错误。

## 明确不属于 R1

- compaction、prune、summary、tail window；
- Context Manifest、token budget、token counter trait；
- artifact / retrieval / working set；
- session 写入、事实修复或 tool 执行；
- provider-specific message 转换。

这些能力若要加入，必须先回到 context 架构对齐，不通过修改 R1 helper 偷渡。

## Tool-call round closure

一个连续 `ToolCall` 段是一次 tool-call round。下一次 model step 之前，round 内每个 call 都必须存在配对的 `ToolResult`。context 只校验 result group 是否闭合 pending call；并发、deadline、join、timeout 等执行政策留到 `loop` / `scheduler` 架构对齐。

R1 保留 provider-neutral message 的语义边界，因此连续同 role message 合法；是否需要合并为 provider wire 所需的交替角色，由 `llm` adapter 处理。

## 相邻模块

- Session Item Log：[`../session/README.md`](../session/README.md)
- Model request 组装：[`../model_input/README.md`](../model_input/README.md)
- LLM message protocol：[`../llm/README.md`](../llm/README.md)
- 实现方案：[`DESIGN.md`](DESIGN.md)
