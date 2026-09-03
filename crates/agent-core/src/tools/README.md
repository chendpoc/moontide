# tools

模型能力的**单次调用契约**：`ToolSpec` 描述能力、`ToolRegistry` 冻结快照、`ToolCall` / `ToolResult` 表达一次调用与结果，`ToolExecutor` 是唯一副作用端口。

**设计：** [`DESIGN.md`](../../DESIGN.md#tools)

## 公开入口

- `ToolSpec` — 模型可见 name / description / input_schema（Draft 2020-12 object）
- `Tool` — spec 与 executor 的运行时绑定；`Tool::execute` 为 crate-internal
- `ToolRegistry` — `new`（冻结 + schema 编译 + 稳定排序）、`resolve`、`iter`；`validate_input` 为 crate-internal
- `ToolCall` — 模型请求事实（`tool_use_id`、name、input）
- `ToolExecutor` — 单次执行 trait；显式接收 `working_dir`
- `ToolResult`、`ToolResultStatus`、`ToolContent`、`ToolCancellationReason` — 规范化结果与持久化 serde

permission（`Allow` / `Ask`）、多 call 顺序、Session 写入与 Turn cancellation 不在本 mod；组合根在 `loop::ToolRuntime` 注入 permission map。第一方 builtins 在 `agent-tools`，单向依赖本 crate。

## 调用边界

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| `model_input` | 读取冻结 `ToolRegistry`，映射 `ToolSchema` | 调 executor |
| `loop` | resolve、validate、经 `ToolRuntime` 编排 execute | 绕过校验或 permission |
| `session` / `event` | 持久化 / 转发 canonical `ToolCall` / `ToolResult` | 反向依赖 executor |
| `agent` | 从 `agent-tools` 构造 registry 与 permission map | 运行中改 snapshot |

executor 预期失败返回 `Ok(ToolResult::failed(...))`；基础设施错误经 `Err` 向上传播，由 loop 先记录 `OutcomeUnknown` 再传到 turn 边界。

## 相邻模块

[`model_input`](../model_input/README.md) · [`loop`](../loop/README.md) · [`session`](../session/README.md) · [`event`](../event/README.md) · [`llm`](../llm/README.md)
