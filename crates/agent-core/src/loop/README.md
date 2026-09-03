# loop

一次用户交互的**编排边界**：独占 Session 运行时依赖，把 `turn()` 串成 Session → Turn → Step → Tool round；统一 LLM retry 与 Turn cancellation，经 event 同步 commit 事实。

**设计：** [`DESIGN.md`](../../DESIGN.md#loop)

## 公开入口

- `AgentLoopInit`、`AgentLoop::new`、`AgentLoop::turn` — 组合根一次性转移 ownership 后的 turn 入口
- `TurnInput`、`TurnPolicy` — 用户文本、config/system、step 与 retry 上限
- `ToolRuntime` — 冻结 registry + `ToolPermissionMap` + 可选 `ToolApprovalHandler`
- `ToolPermission`、`ToolPermissionMap`、`ToolApproval`、`ToolApprovalHandler` — Ask/Allow 与 approval port

`turn(input, CancellationToken) -> Result<ModelResponse>`：R1 直接返回终止响应，不引入 Run 执行实体。LLM retry 为 Step 内 attempt（不重新 compile）；tool round 先 commit 全部 calls 再顺序执行并配对 results。

## 编排接缝

| 模块 | loop 职责 |
|------|-----------|
| `session` | 持有 store；`items()` / `next_turn()`；作 event commit target |
| `context` | preflight 与每 Step 前 `materialize` |
| `model_input` | 每 Step `compile` |
| `llm` | 仅经 `run_model_call*` |
| `tools` | resolve / validate / execute 单次 call |
| `event` | `emit`；不直接 `commit_item` |

`AgentLoop` non-Clone；同实例 Turn 串行。R1 无 OS session lease；Hook 仅 post-commit callback。

## 相邻模块

[`session`](../session/README.md) · [`event`](../event/README.md) · [`context`](../context/README.md) · [`model_input`](../model_input/README.md) · [`llm`](../llm/README.md) · [`tools`](../tools/README.md)
