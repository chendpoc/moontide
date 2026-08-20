# Desktop Host 技术设计

> **对外契约：** [`README.md`](README.md)
> **UI projection：** [`UI-STATE.md`](UI-STATE.md)
> **进程化目标架构：** [`../docs/desktop-process-architecture.md`](../docs/desktop-process-architecture.md)
> **状态：** D1 Host actor、SessionQuery facade 和 EventBuffer 已实现；D3 Iced UI 后置

## 1. 职责与边界

当前 Desktop Host 是同进程 Tokio actor。它是 `Agent` 的唯一 runtime owner，负责把 UI
command 转换为 Agent 调用，把 Progress、approval 和 lifecycle 转换为 DesktopEvent。
它不拥有 Session Item Log 的第二份副本，也不参与 Turn 内部决策。

目标架构将 Iced UI 与 Agent Host 拆成两个进程：UI 只拥有 RenderState 和 protocol
client；Agent Host 独占 Agent、SessionStore、ApprovalBroker 和 runtime lifecycle。
当前 D1 的 in-process Host contract 必须保持可由未来 transport adapter 替换。

```text
Iced UI（D3）
       │ Desktop protocol / in-process adapter
       ▼
DesktopHostActor（目标：agent-host process） ───► DesktopEventStream
    │ owns one Agent                  │ one ordered EventBuffer
    ├── CancellationToken             ├── snapshot coalescing
    ├── ApprovalBroker                └── resync marker
    └── SessionQuery
```

Host crate 不依赖 Iced。Iced 只负责未来的 window、Message/update/view 和
Subscription/Task；Host contract 可以被 CLI、headless test 或未来 Desktop adapter 使用。
跨进程前应把顶层 command/response/event/snapshot contract 收敛为独立的
`desktop-protocol`。但 D1/D3 不做无消费者的全量 payload 搬迁：in-process adapter 可以
复用稳定的 canonical value types；D4 有真实 framed transport、独立版本或非 Rust
consumer 时，再抽取必要的 wire DTO。Agent runtime ownership 类型始终不进入协议 API。

## 2. 模块结构

```text
crates/desktop/src/
  lib.rs       # public exports
  host.rs      # DesktopHost、HostActor、lifecycle
  command.rs   # commands and typed errors
  event.rs     # envelope and EventBuffer
  protocol.rs  # top-level protocol DTO and in-process event adapter
  approval.rs  # ApprovalBroker and request identity
  state.rs     # host state and snapshot
```

依赖方向：`desktop → agent → agent-core + agent-tools`。Desktop 不直接读取 JSONL。
OS-specific window、close 和 packaging 接缝留到 D3/D6，并复用 `agent::platform` 的
项目路径语义。

## 3. Host contract

### 3.0 Protocol extraction boundary

当前 `DesktopHostHandle`、`DesktopEventStream` 和带 oneshot reply 的内部 command 是
D1 in-process host contract，不等于最终 wire API。D2 只冻结以下跨边界语义：

- `DesktopCommand`、`DesktopResponse`、`DesktopProtocolEvent`、`DesktopSnapshot` 的顶层职责；
- `DesktopCommandError` 的稳定匹配语义；
- `DesktopMessageEnvelope` 的版本、request correlation、connection epoch 和 event order；
- Snapshot resync 不 replay 旧事件。

不在 D2 强制复制 `agent-core` 的所有 canonical value payload。若某个 payload 的现有
类型已经是稳定、provider-neutral 的值对象，可以由 in-process adapter 直接复用；不得
复用 Agent、SessionStore、ProgressWorker、observer、task handle 等 runtime ownership
类型。

R1 的 `DesktopProtocolEvent` 将内部 `ProgressEvent` 展开为语义事件；`ToolCall`、
`ToolResult`、`ContentBlock` 和 `ModelResponseSnapshot` 等稳定 canonical payload 暂时
复用，`agent::ModelResponse` 不进入 protocol event。`DesktopEvent` 和带 oneshot 的
`HostCommand` 仍是 D1 内部实现类型。

`DesktopEventStream::recv_protocol(connection_epoch)` 是当前 in-process adapter。它为
事件设置当前 protocol version、epoch 和 seq，request_id 保持为空；command/response
transport 尚未在 R1 实现。原有 `DesktopEvent` / `DesktopEventEnvelope` 仍作为 D1
in-process host API 保留，但不是最终 wire event contract。

### 3.1 配置和生命周期

```rust
pub struct DesktopConfig {
    pub agent: agent::AgentConfig,
    pub session: SessionSelection,
    pub event_capacity: usize,
}

pub enum SessionSelection {
    New,
    Existing(String),
}

impl DesktopHost {
    pub async fn start(
        config: DesktopConfig,
    ) -> anyhow::Result<(DesktopHostHandle, DesktopEventStream)>;
}
```

`event_capacity` 必须至少为 16。`start` 要求 Tokio runtime；它先解析 session selection，
再创建或恢复 Agent，覆盖 `AgentConfig` 的 progress 和 approval 接缝，最后启动 actor。

Host 永远只保存一个 `Agent` 值。active Turn 期间该值暂时由唯一的 turn task 持有，
task 完成后把 Agent 返回 actor；UI、ProgressObserver 和 ApprovalBroker 都不能取得
`&mut Agent`。

### 3.2 Command 与 typed error

```rust
pub enum DesktopCommandError {
    Busy,
    NoActiveTurn,
    ApprovalNotFound,
    ApprovalAlreadyResolved,
    Stopping,
    Stopped,
    EventStreamClosed,
    InvalidInput(String),
    Internal(String),
}
```

command 使用 bounded Tokio channel 和 oneshot reply。`Busy` 是类型语义，不依赖错误
字符串。第二个 active Turn 不排队；空文本在 host 边界拒绝。

### 3.3 Host state

```rust
pub enum DesktopRunState {
    Starting,
    Idle,
    Thinking { turn: u64, step: u32 },
    RunningTool { turn: u64, tool_use_id: String, name: String },
    WaitingApproval { turn: u64, request_id: String },
    Cancelling { turn: u64 },
    Failed { turn: Option<u64>, error: DesktopError },
    Stopping,
    Stopped,
}
```

Host state 是生命周期摘要，不替代 `ProgressEvent` 的 canonical payload。失败不会
回滚已提交的 Session fact；下一 Turn 可以从 `Failed` 恢复到 `Thinking`。

## 4. EventBuffer

### 4.1 数据结构

Desktop 使用一个 bounded `EventBuffer`，不再公开 control lane 和 snapshot lane 的
独立读取语义。

```text
EventBuffer
  └── VecDeque<QueuedEvent>
       ├── control event
       └── replaceable snapshot event
```

每个 queued event 在进入 buffer 时分配递增 `seq`。snapshot 的 key 是
`(turn, llm_call_id)`；同 key 更新只替换 payload，保留原队列位置和 seq。StateChanged
也可被最新状态替换。

### 4.2 满载策略

| 内容 | 策略 |
|---|---|
| Assistant snapshot | 丢弃或合并，增加 `dropped_snapshots`，设置 `resync_required` |
| StateChanged | 合并最新状态 |
| Approval、completion、failure、stopped | 优先保留；空间不足时丢弃 snapshot 腾出位置 |
| 无可丢弃 snapshot 的 control overflow | 设置 degraded/resync 状态，完整 host snapshot 成为权威恢复来源 |

该策略保证丢失可见，不承诺任意时间点的无限事件保留，也不提供 replay buffer。

### 4.3 Resync

```text
event gap / worker loss / buffer degraded
        │
        ▼
snapshot()
  ├── load SessionSnapshot through agent::SessionQuery
  ├── read host lifecycle state
  ├── read pending ApprovalRequest
  └── return DeliveryStatus
        │
        ▼
UI replaces local RenderState and starts a new event baseline
```

`last_delivered_seq` 只用于诊断和当前 delivery 状态。resync 后不从旧 seq replay；UI
保留本地 input draft 和偏好设置，但重建 Session、run state、pending approvals 和
transient assistant draft。

## 5. ApprovalBroker

```rust
pub struct ApprovalRequest {
    pub id: ApprovalId,
    pub turn: u64,
    pub call: agent::ToolCall,
    pub working_dir: std::path::PathBuf,
}
```

Broker 为每次 request 生成独立 ID，保存完整 `ToolCall` 和 oneshot decision sender。
UI 事件携带完整 `ToolCall`，但该 payload 只进入 Desktop EventBuffer，不进入 Session
Item Log 或 Agent Event Log。

approve/deny 只根据 request ID resolve。重复 resolve 和未知 ID 返回 typed error。
cancel、turn completion 和 shutdown 会清理 pending map；清理结果是
`ToolApproval::Cancelled`。

## 6. Session 查询与恢复

`agent-core::session::SessionQuery` 只读打开和校验文件；`agent::SessionQuery` 作为
组合根 facade 导出 `list`、`load`。查询路径不创建 SessionStore writer，不追加日志。

恢复顺序：

```text
SessionQuery::load
  → Agent::resume
  → Host owns Agent
  → UI receives snapshot/events
```

一个 Host 一个 Agent，一个 Session 一个 active Turn。Desktop 不支持后台保留多个 Agent。

## 7. 生命周期

```text
Starting ──Agent create/resume──► Idle
Idle ──SubmitTurn───────────────► Thinking
Thinking ──ToolUse──────────────► RunningTool / WaitingApproval
active ──Cancel─────────────────► Cancelling ──cleanup──► Idle/Failed
active ──error──────────────────► Failed ──new turn──► Thinking
any ──Shutdown──────────────────► Stopping ──flush──► Stopped
```

关闭顺序固定为：

1. 拒绝新 command；
2. cancel active Turn；
3. await turn task 并收回 Agent；
4. cancel pending approvals；
5. flush Progress；
6. flush Agent Event Log；
7. 发布 `Stopped` 并关闭 EventBuffer。

## 8. 不变量

| 不变量 | 违反时 |
|---|---|
| 一个 Host 只有一个 Agent owner | 启动/切换失败，不能复制 writer |
| 一个 Session 最多一个 active Turn | 返回 `Busy`，不排队 |
| 一个 approval request 只有一个 decision | 返回 `ApprovalAlreadyResolved` |
| EventBuffer seq 递增 | buffer 内部错误，进入 resync/Stopped |
| Session Item Log 是恢复事实源 | 不从 Progress 或 Agent Event Log 恢复 |
| shutdown 等待 cleanup + flush | 返回 `ShutdownReport`，不得静默 detach |

## 9. 单测方向

- SessionQuery list/load、非法 id、损坏文件和无副作用；
- command Idle/Busy/Stopping/Stopped acceptance；
- EventBuffer 顺序、snapshot coalesce、overflow marker 和 resync status；
- approval 唯一 decision、完整 ToolCall event 和 cancellation；
- Host create/resume、shutdown、flush 和单 active Turn；
- provider/tool/cancellation 终态由后续真实 provider smoke 补齐。
