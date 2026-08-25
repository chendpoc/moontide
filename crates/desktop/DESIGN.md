# Desktop Host 技术设计

> **对外契约：** [`README.md`](README.md)
> **UI projection：** [`UI-STATE.md`](UI-STATE.md)
> **进程化目标架构：** [`../docs/desktop-process-architecture.md`](../docs/desktop-process-architecture.md)
> **状态：** D1 Host actor、D2 protocol、D3-R1 RenderState fold、D3-PF client/transport 已实现；Web RenderState 迁移待完成

## 1. 职责与边界

当前 Desktop Host 是同进程 Tokio actor。它是 `Agent` 的唯一 runtime owner，负责把 UI
command 转换为 Agent 调用，把 Progress、approval 和 lifecycle 转换为 DesktopEvent。
它不拥有 Session Item Log 的第二份副本，也不参与 Turn 内部决策。

目标架构由 Tauri UI process 与 Agent Host process 组成：Web 前端只拥有 RenderState 和
用户 intent，Tauri Rust shell 拥有窗口、bridge 和 protocol client；Agent Host 独占
Agent、SessionStore、ApprovalBroker 和 runtime lifecycle。
当前 D1 的 in-process Host contract 必须保持可由未来 transport adapter 替换。

```text
Svelte WebView（D3）
       │ Tauri invoke / event bridge
       ▼
Tauri Rust desktop shell
       │ versioned Desktop protocol / transport adapter
       ▼
DesktopHostActor（目标：agent-host process） ───► DesktopEventStream
    │ owns one Agent                  │ one ordered EventBuffer
    ├── CancellationToken             ├── snapshot coalescing
    ├── ApprovalBroker                └── resync marker
    └── SessionQuery
```

Host crate 不依赖 Tauri 或前端框架。Tauri shell 只负责 window、command bridge、event
subscription 和 protocol client；Host contract 可以被 CLI、headless test 或未来 Desktop
adapter 使用。由于 Tauri WebView 是非 Rust consumer，D3 前必须冻结独立的
`desktop-protocol` wire DTO，并提供 TypeScript 类型/fixture conformance；不能继续把
in-process canonical Rust value types 当成最终前端 contract。Agent runtime ownership
类型始终不进入协议 API。

## 2. 模块结构

```text
crates/desktop/src/
  lib.rs       # public exports
  host.rs      # DesktopHost、配置与启动 lifecycle
  host/        # HostActor、handle command、ProgressSink、tests
  host_protocol.rs  # independent wire envelope server boundary
  host_protocol/    # validation、routing、lifecycle and tests
  command.rs   # commands and typed errors
  event.rs     # envelope and EventBuffer
  event/       # EventBuffer tests
  protocol.rs  # top-level protocol DTO and in-process event adapter
  render_state.rs # RenderState module wiring and internal re-exports
  render_state/  # model、fold、projection、tests
  ui.rs        # Tauri bridge bootstrap and protocol subscription seam
  ui/          # legacy Iced shell; migration target is frontend/ RenderState
  frontend/    # Svelte + TypeScript app (D3 migration target)
  approval.rs  # ApprovalBroker and request identity
  state.rs     # host state and snapshot
```

依赖方向：`desktop → agent → agent-core + agent-tools`。Desktop 不直接读取 JSONL。
OS-specific window、close 和 packaging 接缝留到 D3/D6，并复用 `agent::platform` 的
项目路径语义。

## 3. Host contract

### 3.0 Protocol extraction boundary

当前 `DesktopHostHandle`、`DesktopEventStream` 和带 oneshot reply 的内部 command 是
D1 in-process host contract，不等于最终 wire API。独立 `desktop-protocol` crate 冻结以下
跨边界语义：

- `DesktopCommand`、`DesktopResponse`、`DesktopProtocolEvent`、`DesktopSnapshot` 的顶层职责；
- `DesktopCommandError` 的稳定匹配语义；
- `DesktopMessageEnvelope` 的版本、request correlation、connection epoch 和 event order；
- Snapshot resync 不 replay 旧事件。

`desktop-protocol` 不复用 `agent-core` canonical value payload；所有 v1 DTO 都是独立、
可 serde 的 wire value。`DesktopEvent` 和带 oneshot 的 `HostCommand` 仍是 D1 内部实现
类型。R2 的 active path 必须在 Host boundary 直接接收和发出 independent envelope，不能
要求 Tauri 或 TypeScript consumer 经过 `desktop::protocol` 的平行 graph。

`DesktopEventStream::recv_protocol(connection_epoch)` 与 `desktop::protocol` 暂时保留给
已有 D1/RenderState 测试；它们不是 R2 server 的 active path，并在 TypeScript parity 后
由 R6 删除。

### 3.1 Host protocol server（R2）

R2 增加单 connection、单 Session、单 Host 的 protocol server actor：

```text
Unhandshaken { AgentConfig }
    │ Handshake / allocate connection_epoch
    ▼
Ready { AgentConfig, connection_epoch }
    │ first valid StartSession / consume AgentConfig
    ├── start succeeds ──► Running { DesktopHostHandle, DesktopEventStream }
    └── start fails ─────► Stopped
                              ▲
Running ── Shutdown / channel failure ──┘
```

公开 seam 由 `DesktopProtocolServer::start(DesktopProtocolConfig)`、cloneable
`DesktopProtocolServerHandle::request(DesktopMessageEnvelope)` 与
`DesktopProtocolEventStream::recv()` 组成，精确签名以 `README.md` 为准。server actor 是
protocol connection/lifecycle owner；D1 Host 在成功 `StartSession` 后仍是唯一 Agent owner。

验证顺序固定：

1. payload 必须是 command，且 envelope 必须满足 v1 command identity；
2. `Handshake` 校验 version，分配非零 epoch，并返回相同 request ID；
3. 其他 command 必须携带当前 epoch，且只能在允许的 lifecycle state 执行；
4. domain acceptance/rejection 被编码为相同 request ID 的 response envelope；缺少 request
   ID、伪造 seq、错误 payload kind 或 epoch mismatch 等不可安全继续的 framing error 由
   `request` 返回 infrastructure error，R3 transport 将其视为连接失败；
5. Host event 在 adapter 内直接转为 wire event，沿用 EventBuffer 的 seq，并附加当前 epoch。

同一 server 上重复 `Handshake` 幂等返回已分配 epoch，不建立第二个 connection generation，
也不重置 Ready/Running lifecycle。新的 epoch 只能由 composition root 创建新 server 获得。

首次有效 `StartSession` 是 one-shot boot。`AgentConfig` 不 clone；启动成功或失败后都不再
允许该 server 创建第二个 Agent。失败返回 `Rejected(Internal)` 后关闭 command/event
channels。需要用户修改 settings 后重试时，composition root 必须显式创建新的 server，
不能在 adapter 内加入隐藏 config factory。

`CancelTurn` 需要在 accept cancellation 的同一 actor transition 中取得 active turn ID。
内部 `HostCommand::CancelTurn` reply 因此返回 `u64`；现有 public
`DesktopHostHandle::cancel_turn() -> Result<(), DesktopCommandError>` 丢弃该 ID，新的
crate-private adapter method 将它编码为 `CancellationAccepted { turn }`。禁止通过 boot
snapshot 推断 active turn，因为该读取与 cancel transition 之间存在 race。

Shutdown 必须保持 `Stopped` event 先于 `ShutdownCompleted` response 的可观察顺序。server
取得 D1 shutdown report 后排空 Host event stream，再回复 request，随后关闭两个公开 channel。
event forwarder 的 drain 等待上限为 2 秒；若 receiver 不消费或 task 无法收束，server abort
forwarder、让 request 返回 infrastructure error 并关闭连接，不发送 `ShutdownCompleted`。

现有 Tauri tracer bullet 仍临时调用 `#[doc(hidden)] desktop::wire`，因此 R2 不在未改 Tauri
consumer 的情况下收窄该模块可见性。R3 rewiring 后不再新增调用方，R6 删除 mapper 与平行
`desktop::protocol` graph。

### 3.2 配置和生命周期

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

### 3.3 Command 与 typed error

```rust
pub enum DesktopCommandError {
    ProtocolVersionUnsupported,
    HandshakeRequired,
    SessionNotStarted,
    SessionAlreadyStarted,
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

### 3.4 Host state

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

### 3.5 RenderState fold（D3-R1）

`RenderState` 是 `desktop` crate 内部的 UI-owned projection。它只读取 protocol event 和
snapshot，不拥有 Agent、SessionStore 或 approval truth：

```rust
pub(crate) struct RenderState {
    pub(crate) session: Option<agent::SessionSnapshot>,
    pub(crate) run: DesktopRunState,
    pub(crate) messages: Vec<MessageView>,
    pub(crate) assistant_drafts: BTreeMap<AssistantDraftKey, AssistantDraftView>,
    pub(crate) tools: BTreeMap<String, ToolView>,
    pub(crate) approvals: BTreeMap<String, ApprovalView>,
    pub(crate) notices: Vec<NoticeView>,
    pub(crate) delivery: DeliveryView,
    pub(crate) stopped_report: Option<ShutdownReport>,
    finalized_calls: BTreeSet<AssistantDraftKey>,
}

impl RenderState {
    pub(crate) fn apply_message(
        &mut self,
        envelope: DesktopMessageEnvelope,
    ) -> RenderFoldResult;
    pub(crate) fn replace_snapshot(&mut self, snapshot: DesktopSnapshot);
}

pub(crate) enum RenderFoldResult {
    Applied,
    Ignored,
    ResyncRequired,
}
```

`NoticeView` 和 `DeliveryView` 是上述 projection 的内部辅助值，不是新的协议类型：

```rust
pub(crate) struct NoticeView {
    pub(crate) kind: NoticeKind,
    pub(crate) message: String,
    pub(crate) recoverable: bool,
    pub(crate) error_kind: Option<DesktopErrorKind>,
}

pub(crate) struct DeliveryView {
    pub(crate) connection_epoch: Option<ConnectionEpoch>,
    pub(crate) last_seq: Option<Seq>,
    pub(crate) awaiting_snapshot: bool,
    pub(crate) resync_required: bool,
    pub(crate) dropped_snapshots: u64,
    pub(crate) buffered_events: usize,
    pub(crate) resync_reason: Option<ResyncReason>,
}
```

事件只接受当前 epoch 内严格递增的 seq；旧 seq 忽略，gap 或缺失 seq 设置 resync marker
并停止猜测后续状态。发现更高 epoch 时先进入 `awaiting_snapshot`，在 snapshot 替换
baseline 前不消费该 epoch 的事件。snapshot 替换 Session history、host state、approval 和
delivery baseline；`DesktopSnapshot.active_assistant_calls` 只保留仍 active 的 transient
assistant draft identity，无法证明 active 的 draft 删除并显示可恢复 notice。它不复制 draft
内容。`AssistantResponseSnapshot` 按
`(turn, llm_call_id)` 替换，`AssistantFinalized` 删除 draft 并只追加一次历史消息；没有
对应 ToolCall 的 ToolResult 请求 resync，不创建孤立工具卡片。`TurnFailed` 保留错误类别
和可恢复性；`Stopped` 保留 `ShutdownReport`；`TurnCompleted` 将 UI run state 收敛到
`Idle`。

UI 在任一 snapshot 请求进行期间暂存收到的 protocol event；snapshot 成为新的 delivery
baseline 后，按原 seq 顺序重放暂存事件。这样事件可能先于 snapshot response 被 EventBuffer
消费，也可能晚于 snapshot response 到达 UI，都不会让本地 `last_seq` 回退并制造伪造 gap。
重放期间再次发现 gap 时停止重放剩余事件，并重新请求 snapshot。

### 3.6 Tauri/Web shell（D3-PF）

`moontide-desktop` 内部的 Rust client 由一个 actor 拥有 request counter、pending map、
handshake epoch 和 disconnect cleanup。调用者只传 `DesktopCommand`：

```rust
DesktopProtocolClient::start(ClientTransport, event_capacity)
    -> (DesktopProtocolClient, DesktopProtocolClientEventStream);

DesktopProtocolClient::request(DesktopCommand)
    -> anyhow::Result<DesktopMessageEnvelope>;
```

`ClientTransport` 是 bounded outgoing/incoming envelope channel pair；fake transport 与 D3
in-process transport 使用同一 client seam。in-process pump 并发执行 R2 server request，使用
event-first merge 保持已经由 Host 入队的 `Stopped` 先于 `ShutdownCompleted` 交付。D4 只需
把 channel peer 改接 framed child-process IO，不修改 client、bridge 或 frontend contract。

应用 composition root 保留当前环境/provider/tool preset，装配
`DesktopProtocolServer → in-process transport → client` 后再把 client/event stream 注入 shell。
Tauri setup、command handler 与 window handler不 import `AgentConfig`、Session selection 或
Host handle。WebView 先监听 `desktop-envelope`/`desktop-connection`，再通过唯一
`desktop_request(DesktopCommand)` bridge 完成 Handshake 和 StartSession。Rust client 分配
request ID 并注入 epoch；domain rejection 保持完整 response envelope，bridge error 只表示
client/transport failure。

窗口 close 首先阻止默认 close，最多等待三秒的 protocol Shutdown；只在收到
`ShutdownCompleted` 时记为 clean，其余 timeout/transport/domain result 记为 degraded evidence，
随后使用不重复触发 close event 的 window destroy。普通 Enter、Cmd/Ctrl+Enter、Escape 和
approval intent 的当前用户行为由 plain-JavaScript call seam 暂时保留；TypeScript
`RenderState`、Svelte 和完整 resync orchestration 属于下一 Review 批。

前端组件只负责布局组合，Conversation、Approval、Inspector 和 Composer 分别负责局部 view；
组件只读取 `RenderState` 子投影并生成 intent，不拥有 Host 或 Session 事实。Tauri command
capability 采用最小 allowlist；Tauri event 只发送 protocol envelope，不直接发送任意
Rust object。

### 3.7 Inspector（D3-R3）

Inspector 是 UI-owned 的局部 detail view，不创建新的 Host 或 protocol state。`UiState`
只保存是否打开、当前 selection 和 thinking 展开偏好：

```rust
enum InspectorSelection {
    Tool { tool_use_id: String },
    Approval { approval_id: String },
    Thinking { turn: u64, llm_call_id: String },
}
```

Tool、Approval 和 assistant draft 的 canonical payload 继续由 `RenderState` 提供；Inspector
只读取它们并渲染详情。关闭 Inspector、切换 selection 或展开 thinking 不发送 Host command，
也不修改 Session Item Log、approval truth 或 protocol envelope。

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
保留本地 input draft 和偏好设置，但重建 Session、run state、pending approvals；只按
`DesktopSnapshot.active_assistant_calls` 保留仍可证明有效的 transient assistant draft，
其余 draft 删除并显示可恢复 notice。

初始 boot snapshot 也遵守同一 gate：snapshot 完成前到达 UI 的事件暂存，不直接 fold；
完成后按 seq 顺序重放。若 snapshot response 已包含某个事件的 `last_delivered_seq`，该
事件在重放时按 stale event 忽略；否则从 snapshot baseline 的下一条 seq 正常应用。

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
