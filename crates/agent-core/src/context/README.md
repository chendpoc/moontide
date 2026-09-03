# context

Session Item Log → 模型可见 `Vec<Message>` 的**唯一 materialize 出口**：只读、确定性装配，不写 session、不执行 tool、不做 provider wire 转换。

**设计：** [`DESIGN.md`](../../DESIGN.md#context)

## 公开入口

- `materialize(items: &[SessionItem]) -> Result<Vec<Message>>` — `pub(crate)`；唯一 runtime 入口，caller 为 `loop`

映射要点：普通 user/assistant item 直映；连续 `ToolCall` / `ToolResult` 分别聚合为 assistant `ToolUse` 与 user `ToolResult` message；`CheckpointCreated` 对模型透明；`Compaction` 在 R1 返回错误。tool call/result 按 `tool_use_id` 与 name 配对校验；`ToolResultStatus` 不伪造进 protocol block。

R1 不做 compaction、tail window、token budget 或 manifest；连续同 role message 合法，provider 角色交替由 `llm` adapter 处理。

空 log 返回空 `Vec<Message>`；扫描结束 pending tool call 非空则报错。函数只读输入，无 session/event/file 副作用。

## 调用边界

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| `loop` | 每 Step 前 materialize → `model_input::compile` | 自行遍历 `SessionItem` 组消息 |
| `session` | 提供只读 items | 反向调用 context |
| `model_input` | 消费 `Vec<Message>` | 再次 materialize 或裁剪 |

## 相邻模块

[`session`](../session/README.md) · [`model_input`](../model_input/README.md) · [`loop`](../loop/README.md) · [`llm`](../llm/README.md) · [`tools`](../tools/README.md)
