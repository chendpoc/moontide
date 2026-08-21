# MoonTide Desktop

> **性质：** Desktop 产品与宿主契约
> **状态：** v0.1 D1 Host、D2 protocol、D3-R1 RenderState 和 D3-R2 Iced shell 已实现；完整 D3 UI 尚未完成
> **实现设计：** [`DESIGN.md`](DESIGN.md)
> **UI 状态契约：** [`UI-STATE.md`](UI-STATE.md)
> **UI 交互契约：** [`UI-INTERACTION.md`](UI-INTERACTION.md)
> **UI 技术决策：** [`UI-TECH-CHOICE.md`](UI-TECH-CHOICE.md)
> **进程化目标架构：** [`../docs/desktop-process-architecture.md`](../docs/desktop-process-architecture.md)

## 1. 这是什么

`desktop` 当前是本地桌面产品的 Host contract 与 D1 Host actor crate。它把一个可恢复的
`agent::Agent` 暴露给未来的 Iced UI，但不复制 AgentLoop，也不把 UI 策略放进
`agent-core`。目标架构会把 Iced UI 与 Agent Host 拆为两个进程，中间经独立的
`desktop-protocol` 顶层 contract 通信。当前 D1/D3 不要求立即复制全部嵌套 payload；
in-process adapter 可以复用稳定的 canonical value types，必要的独立 wire DTO 在
D4 有真实 transport 需求时再抽取。

```text
Iced UI（D3，目标为独立 UI process）
    │ Desktop protocol / in-process adapter
    ▼
Desktop Host Actor（当前同进程；目标为 agent-host process）
    │ owns exactly one Agent
    ├── ProgressObserver → ordered EventBuffer
    ├── ApprovalBroker   → approval events + decisions
    ├── SessionQuery     → read-only history / recovery
    └── lifecycle        → cancel / flush / shutdown
    ▼
agent → agent-core + agent-tools
```

v0.1 D1 的实现边界是：单窗口、单活跃 Session、单活跃 Turn、同一进程、Turn 串行。
进程化目标仍保持单 Host、单 Session、单 active Turn；拆分进程不改变 Agent ownership
和 Session Item Log 事实源。

## 2. 谁该用什么

| 调用者 | 使用 | 禁止 |
|---|---|---|
| Iced UI | `DesktopHostHandle`、`DesktopEventStream`、`DesktopSnapshot` | 调用 `Agent::turn`、读取 JSONL、访问 `agent-core` 内部模块 |
| Desktop Host | `agent::Agent`、`ProgressObserver`、`ToolApprovalHandler`、`SessionQuery` | 把 RenderState 写回 Session Item Log |
| `agent` | Agent 装配、Progress、approval 和 Session query facade | 依赖 Iced 或窗口生命周期 |
| `agent-core` | Turn、Session、LLM、Tool 和 Event 事实语义 | 依赖 Desktop、发送 UI 命令 |
| 平台接缝 | `agent::platform` 和 Desktop 的极少量窗口/进程 API | 复制 `fs` / `path` 抽象或手写分隔符 |

Session Item Log 是恢复事实源；Progress 和 Desktop EventBuffer 是实时视图输入；Agent
Event Log 是可丢弃诊断数据。Desktop protocol 是 UI transport contract，不是第四种
事实源。

## 3. 宿主公开契约

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

pub struct DesktopHost;

impl DesktopHost {
    pub async fn start(
        config: DesktopConfig,
    ) -> anyhow::Result<(DesktopHostHandle, DesktopEventStream)>;
}

pub struct DesktopHostHandle;

impl DesktopHostHandle {
    pub async fn submit_turn(&self, text: String)
        -> Result<u64, DesktopCommandError>;
    pub async fn cancel_turn(&self)
        -> Result<(), DesktopCommandError>;
    pub async fn approve(&self, request_id: String)
        -> Result<(), DesktopCommandError>;
    pub async fn deny(&self, request_id: String, reason: String)
        -> Result<(), DesktopCommandError>;
    pub async fn snapshot(&self)
        -> Result<DesktopSnapshot, DesktopCommandError>;
    pub async fn shutdown(self)
        -> Result<ShutdownReport, DesktopCommandError>;
}

pub struct DesktopEventStream;

impl DesktopEventStream {
    pub async fn recv(&mut self) -> Option<DesktopEventEnvelope>;
}
```

`DesktopHost::start` 要求 Tokio runtime。Host 接管 `AgentConfig` 中的 progress 与
approval 注入点，调用方不得同时安装另一个同类 handler。

`DesktopCommandError` 是 UI 可匹配的稳定错误类型，包含
`ProtocolVersionUnsupported`、`HandshakeRequired`、`SessionNotStarted`、
`SessionAlreadyStarted`、`Busy`、`NoActiveTurn`、`ApprovalNotFound`、
`ApprovalAlreadyResolved`、`Stopping`、`Stopped`、`EventStreamClosed`、
`InvalidInput` 和 `Internal`。

### 3.1 D2 protocol contract

D2 增加不携带 Host channel 或 reply handle 的顶层协议类型：

```rust
pub enum DesktopCommand {
    Handshake,
    StartSession { selection: SessionSelectionDto },
    SubmitTurn { text: String },
    CancelTurn,
    Approve { approval_id: String },
    Deny { approval_id: String, reason: String },
    Snapshot,
    Shutdown,
}

pub enum DesktopResponse {
    HandshakeAccepted { protocol_version: ProtocolVersion },
    SessionReady { snapshot: DesktopSnapshot },
    TurnAccepted { turn: u64 },
    CancellationAccepted { turn: u64 },
    ApprovalAccepted { approval_id: String },
    Snapshot { snapshot: DesktopSnapshot },
    ShutdownCompleted { report: ShutdownReport },
    Rejected { error: DesktopCommandError },
}

pub struct DesktopMessageEnvelope {
    pub protocol_version: ProtocolVersion,
    pub connection_epoch: Option<ConnectionEpoch>,
    pub request_id: Option<RequestId>,
    pub seq: Option<Seq>,
    pub payload: DesktopMessage,
}
```

`DesktopProtocolEvent` 将 `ProgressEvent` 映射为稳定的语义事件（例如
`AssistantResponseSnapshot`、`ToolCall`、`ToolResult`、`AssistantFinalized` 和
`TurnEnded`），不把 `ProgressEvent` wrapper 或 `ModelResponse` 直接暴露给 UI。
当前稳定的 canonical value payload 可以复用；独立 wire DTO 后置到 D4。

D3-R1 的 `RenderState` 是 UI-owned 的 crate 内部 projection。它只消费
`DesktopMessageEnvelope` 中的 `DesktopProtocolEvent` 和 `DesktopSnapshot`，负责 draft、
conversation、tool、approval、notice 和 delivery state；它不拥有 Agent、SessionStore 或
approval truth，也不写 Session Item Log。

D3-R2 提供 `run_ui(host, events, connection_epoch)`。Host 和 protocol stream 由调用者注入；
UI 不负责 settings、provider 或 Session bootstrap。当前 shell 只验证协议订阅、conversation、
composer、Stop、approval 和 error 的最小接缝，完整 Workbench 面板后置。

## 4. 事件与恢复

所有 Desktop 事件进入一个有序 bounded `EventBuffer`。高频
`AssistantResponseSnapshot` 按 `(turn, llm_call_id)` 合并，control event 保留优先级。
事件的 `seq` 按进入该缓冲的顺序递增，不存在独立 lane 的全局排序问题。

```rust
pub struct DesktopEventEnvelope {
    pub seq: u64,
    pub session_id: String,
    pub payload: DesktopEvent,
}
```

D2 提供 in-process adapter：

```rust
impl DesktopEventStream {
    pub async fn recv_protocol(
        &mut self,
        connection_epoch: ConnectionEpoch,
    ) -> Option<DesktopMessageEnvelope>;
}
```

`request_id` 只匹配 command/response；`seq` 只表示当前 `connection_epoch` 内的 Host
delivery order；snapshot coalesce 和 resync 不改变“不 replay 旧 seq”的语义。

当 snapshot 丢失、worker degraded 或 buffer 无法继续接收时，设置 `resync_required`。
UI 调用 `snapshot()`，以返回的完整状态作为新的基线；不承诺从旧 seq replay。

`DesktopSnapshot` 包含 Session view、host lifecycle state、pending approvals 和
`DeliveryStatus`：

```rust
pub struct DeliveryStatus {
    pub last_delivered_seq: u64,
    pub resync_required: bool,
    pub dropped_snapshots: u64,
    pub buffered_events: usize,
}
```

## 5. Session 查询

Desktop 不解析 Session JSONL。`agent::SessionQuery` 是只读 facade，底层由
`agent-core::session` 读取和校验 Session Item Log：

```rust
pub struct SessionQuery;

impl SessionQuery {
    pub fn new(sessions_dir: std::path::PathBuf) -> Self;
    pub fn list(&self) -> anyhow::Result<Vec<agent::SessionSummary>>;
    pub fn load(&self, session_id: &str)
        -> anyhow::Result<agent::SessionSnapshot>;
}
```

查询不创建 writer、不追加文件。恢复运行仍通过 `Agent::resume`，而不是把查询结果
重新组装成第二个 writer。

## 6. Approval 边界

Approval UI event 保留完整 `ToolCall`，用于展示和用户决策。它只存在于 Desktop
事件流，不写入 Session Item Log 或 Agent Event Log。approve/deny 只携带独立
`ApprovalId`；窗口关闭和 cancellation 会让 pending request 返回 `Cancelled`。

## 7. 进程化演进

当前 D1 保持 Host actor 与未来 UI 同进程，便于先验证 RenderState、EventBuffer 和
生命周期。D2 先冻结 command/response/event/snapshot 的顶层语义，以及
`connection_epoch`、`request_id`、`seq` 的规则，并提供 in-process adapter。D1/D3
可以复用稳定的 canonical value types；只有 D4 真正拆进程、需要独立版本或出现非 Rust
consumer 时，才抽出不依赖 Iced、`agent` 和 `agent-core` 的必要 wire DTO。

AgentLoop 初期仍是 Agent Host 内的 Tokio task；subagent 先是逻辑 runtime/actor；daemon
是未来独立生命周期的 sibling/service，不作为 Agent 子进程。

完整 owner、协议、重连、resync 和阶段划分见
[`crates/docs/desktop-process-architecture.md`](../docs/desktop-process-architecture.md)。

## 8. 非目标

- D1 不实现完整 Iced 窗口、Conversation、Session Rail、Inspector 和 Composer；
- 多 Session 并发、多 Agent、后台队列和 scheduler；
- D1 当前不实现 daemon、server、IPC、sidecar 和跨设备同步；IPC 作为 D4 进程拆分目标，
  daemon 仍以后置独立 runtime 为边界；
- Desktop 直接实现 Session fork、diff 或文件索引；
- 在 `agent-core` 中引入 Iced、窗口状态或 UI render object；
- 为每个操作系统复制一套 filesystem/path common library。

详细 ownership、状态机、事件缓冲和关闭顺序见 [`DESIGN.md`](DESIGN.md)。
