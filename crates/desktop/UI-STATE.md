# Desktop RenderState 契约

> **性质：** UI-owned projection contract
> **状态：** v0.1 baseline；D1 Host、D3-R1 RenderState fold 已实现；Tauri/Web 前端接缝待迁移
> **输入：** `DesktopMessageEnvelope`（其中的 `DesktopProtocolEvent`）与 `DesktopSnapshot`

## 1. 目的

RenderState 把 Host 事件折叠成前端 view state。它不是 Agent 状态机，不
写 Session Item Log，也不承担 provider stream 的 delta 拼接。当前 D1 通过同进程
adapter 消费 `DesktopMessageEnvelope` 中的 `DesktopProtocolEvent`；Tauri bridge 和进程
拆分后继续消费同一顶层协议，RenderState 不随 transport 变化。

```text
DesktopMessageEnvelope(Event) ──fold──► RenderState ──► Svelte component view
                                             ▲
                                  DesktopSnapshot resync
```

## 2. 状态结构

```rust
struct RenderState {
    session: SessionView,
    run: RunView,
    messages: Vec<MessageView>,
    assistant_drafts: BTreeMap<AssistantDraftKey, AssistantDraftView>,
    tools: BTreeMap<String, ToolView>,
    approvals: BTreeMap<String, ApprovalView>,
    notices: Vec<NoticeView>,
    delivery: DeliveryView,
    stopped_report: Option<ShutdownReport>,
}

struct AssistantDraftKey {
    turn: u64,
    llm_call_id: String,
}
```

Draft key 不是 `step`。`step` 用于展示执行进度；`llm_call_id` 才是同一流式模型
调用的稳定替换边界。

## 3. Fold 规则

### 3.1 Assistant snapshot

收到 `DesktopProtocolEvent::AssistantResponseSnapshot`：

1. 检查 envelope seq 是否已处理；旧 seq 丢弃；
2. 以 `(turn, llm_call_id)` 查找 draft；
3. 用完整 `ModelResponseSnapshot` 替换 draft，不追加 snapshot.content；
4. 记录 `update_index` 供诊断和 UI loading 状态使用；
5. `pending` 只作为当前 draft 的未完成 block，不写入 message history。

所以流式表现是 UI 重新绘制同一个 assistant bubble：

```text
Hel → Hello → Hello, wor → Hello, world
```

而不是把每次 snapshot 当成四条 assistant message。

### 3.2 Assistant finalized

收到 `DesktopProtocolEvent::AssistantFinalized`：

1. 找到同 turn/call 的 draft；
2. 删除 draft；
3. 将 finalized blocks 写入 conversation view；
4. 如果已有相同 `(turn, llm_call_id)` 的 finalized message，视为重复事件并忽略；
5. 等待 `TurnCompleted` 作为整轮成功终态。

`AssistantFinalized` 是事实提交后的宿主事件，但 `TurnCompleted.response` 仍是 Agent
调用的最终返回值；UI 不用 finalized 事件拼出成功响应的唯一副本。

### 3.3 Tool 与 approval

- `ToolCall` 以 `tool_use_id` 建立或替换 ToolView；
- `ToolResult` 只匹配同一个 `tool_use_id`，状态和完整 content 都保留；
- `ApprovalRequested` 以独立 `ApprovalId` 建立待处理卡片；
- approve/deny command 的结果由 host event 或 snapshot 清除 pending approval；
- `Denied`、预期失败和 `OutcomeUnknown` 分开显示，不由 UI 统一成“工具失败”。

### 3.4 Errors and lifecycle

- `StateChanged` 更新顶部运行状态，但不清空已展示的 Session history；
- `TurnFailed` 生成可复制的 notice，并将 run 状态置为可恢复的 Failed/Idle；
- `ResyncRequired` 设置 delivery marker，不猜测中间内容；
- `Stopped` 禁用输入和 approval，保留最后一条错误/关闭报告。

## 4. Resync

触发条件：

- envelope seq 出现 gap；
- 收到高于当前值的 `connection_epoch`；
- `ResyncRequired`；
- Progress status 的 `resync_required`；
- Desktop 窗口重新激活且本地 RenderState 不可信；
- 用户主动点击 reload/recover。

resync 流程：

```text
handle.snapshot()
  → replace SessionView / RunView / pending approvals
  → clear only transient drafts whose call is no longer active
  → preserve local input draft and UI preferences
  → reset local event baseline
  → queue events while snapshot is in flight
  → replay queued events only after the snapshot baseline is installed
```

收到更高 `connection_epoch` 后，RenderState 进入 `awaiting_snapshot`，不消费该 epoch 的
事件；旧 epoch 事件忽略。`DesktopSnapshot` 是新 epoch 的唯一基线，替换完成后才允许从
该 snapshot 的 delivery seq 继续折叠事件。

`DesktopSnapshot.active_assistant_calls` 只包含 Host 仍能证明有效的
`(turn, llm_call_id)` identity；RenderState 只保留与这些 identity 匹配的本地 draft，不把
draft 内容复制进 snapshot。

初始 boot snapshot 也遵守同一 gate：snapshot 完成前到达 UI 的事件暂存，不直接 fold；
完成后按 seq 顺序重放。若 snapshot response 已包含某个事件的 `last_delivered_seq`，该
事件在重放时按 stale event 忽略；否则从 snapshot baseline 的下一条 seq 正常应用。

Session Item Log 是已完成消息、tool call/result 和恢复历史的来源；进行中的 assistant
draft 若没有出现在 Session Item Log，只能显示为当前 host snapshot 的 transient state。
如果 resync 无法证明 draft 仍属于 active call，删除它并显示可恢复 notice。`last_delivered_seq`
只用于当前 delivery 诊断；resync 不提供旧事件 replay。

## 5. 不变量

1. 一个 `AssistantDraftKey` 同时最多一个 draft；
2. 同一 draft 只接受单调的 `update_index`；
3. finalized 后不得再次显示同一 call 的 draft；
4. ToolResult 没有对应 ToolCall 时显示数据异常并请求 resync，不创建孤立工具卡片；
5. UI 不把 Progress、Agent Event Log 或本地缓存当成 Session resume 事实；
6. UI 输入文本在 `submit_turn` 被 host 接受前不进入 Session；发送失败时保留输入，避免
   用户文本丢失。

## 6. 不属于 RenderState 的内容

- provider SSE delta fold；
- approval 决策、retry、cancel 和 tool permission；
- Session JSONL 解析与写入；
- API key、settings schema 和路径 canonicalization；
- 跨窗口共享、后台任务和多 Session 调度。
