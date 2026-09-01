# MoonTide Desktop

> **性质：** Desktop 产品与宿主契约
> **状态：** v0.1 D3-PF 已实现：protocol-first 同进程 Host、Svelte/TypeScript RenderState；D4 进程拆分待实现
> **实现设计：** [`DESIGN.md`](DESIGN.md)
> **UI 状态契约：** [`UI-STATE.md`](UI-STATE.md)
> **UI 交互契约：** [`UI-INTERACTION.md`](UI-INTERACTION.md)
> **v0.1 Scope 定稿：** [`UI-V0.1-SCOPE.md`](UI-V0.1-SCOPE.md)
> **UI 视觉方向：** [`UI-VISUAL-DIRECTION.md`](UI-VISUAL-DIRECTION.md)
> **UI 技术决策：** [`UI-TECH-CHOICE.md`](UI-TECH-CHOICE.md)
> **栈精简计划：** [`../docs/desktop-stack-simplification-refactor.md`](../docs/desktop-stack-simplification-refactor.md)
> **进程化目标架构：** [`../docs/desktop-process-architecture.md`](../docs/desktop-process-architecture.md)

## 1. 这是什么

`desktop` 当前是本地桌面产品的 Host contract 与 D1 Host actor crate。它把一个可恢复的
`agent::Agent` 暴露给 Desktop Host，但不复制 AgentLoop，也不把 UI 策略放进
`agent-core`。新的目标架构由 Tauri shell 承载轻量 Web 前端；前端通过 Tauri bridge
消费 versioned `desktop::protocol`，当前由同进程 Desktop Host 拥有 Agent runtime；D4 才
替换为独立 `agent-host` 进程。由于
前端是非 Rust consumer，独立 wire DTO 和 TypeScript 类型边界现在属于 Tauri 垂直切片
的前置工作，不再延后到未来某个抽象的 D4。

```text
Svelte + TypeScript WebView（Tauri UI process）
    │ Tauri invoke / event bridge
    ▼
Tauri Rust desktop shell
    │ versioned Desktop protocol / transport adapter
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

### 1.1 当前实现与产品目标

本文其余章节记录 **已实现的 D3-PF Host、wire 与 RenderState 基础**。已确认的 v0.1
产品目标是 `Provider/bootstrap ready → Blank Conversation → Loaded Conversation`，由 UI Scope、
Interaction、Visual Direction 与 Chat Implementation Plan 共同定义。

一个窗口同一时刻只 loaded/running 一个 Session、一个 Agent 和一个 active Turn。当前实现只覆盖
单 Session 的 Host/protocol/conversation projection 基础；Session catalog、Blank identity、
first-send transaction 和 protocol server generation 重建仍待实现。

v0.1 目标 UI 能力：

- `240px Session Sidebar + Main Chat Surface`；
- Blank Conversation 的欢迎语与居中 Composer；
- Loaded Conversation 的 reading column、typed inline blocks 与 sticky Composer；
- Host-owned Session catalog 与唯一 loaded Session identity；
- controller-owned first-send、New Chat、load/switch 和 fresh generation lifecycle；
- frontend-local shared draft、White/Black theme、Sidebar、detail disclosure 与 reading anchor。

Single-Agent Terminal、PTY、Activity Rail、Project Navigator、Content Deck、Agent Dock、
Floating Island、File、Plan 与 Pins 是后置研究方向，不得从本文的现有契约推断为已实现或
v0.1 acceptance。

## 2. 谁该用什么

| 调用者 | 使用 | 禁止 |
|---|---|---|
| Web 前端 | protocol client、`RenderState`、Tauri command wrapper | 调用 `Agent::turn`、读取 JSONL、访问 `agent-core` 内部模块 |
| Tauri Rust shell | window lifecycle、bridge、protocol client | 拥有 Agent、SessionStore、Approval truth、UI RenderState |
| Desktop Host | `agent::Agent`、`ProgressObserver`、`ToolApprovalHandler`、`SessionQuery` | 把 RenderState 写回 Session Item Log |
| `agent` | Agent 装配、Progress、approval 和 Session query facade | 依赖 Tauri、Svelte 或窗口生命周期 |
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

D2 的跨进程/跨语言契约由 `desktop::protocol` 模块定义，不携带 Host channel、reply
handle、`Agent` 或 `agent-core` runtime ownership 类型：

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
Rust 和 TypeScript consumer 都必须符合 `desktop/tests/protocol/fixtures/**` 冻结的 v1 JSON，
不得从 Host domain types 或 frontend projection 生成第二套 wire contract。

`desktop::protocol` 是唯一公开 wire graph。Host canonical values 只在私有
`host_protocol::adapter` 边界转换为 DTO；`desktop` 不再公开平行 command、response、event
或 envelope graph。

### 3.2 D3-PF Host protocol server（R2 contract）

R2 在 `desktop` crate 增加 Host-side protocol adapter。该 adapter 是纯 Rust in-process
boundary，不依赖 Tauri；R3 的 in-process transport 和未来进程 transport 都消费同一
envelope seam：

```rust
pub struct DesktopProtocolConfig {
    pub agent: agent::AgentConfig,
    pub event_capacity: usize,
}

pub struct DesktopProtocolServer;
pub struct DesktopProtocolServerHandle;
pub struct DesktopProtocolEventStream;

impl DesktopProtocolServer {
    pub fn start(
        config: DesktopProtocolConfig,
    ) -> anyhow::Result<(
        DesktopProtocolServerHandle,
        DesktopProtocolEventStream,
    )>;
}

impl DesktopProtocolServerHandle {
    pub async fn request(
        &self,
        envelope: desktop::protocol::DesktopMessageEnvelope,
    ) -> anyhow::Result<desktop::protocol::DesktopMessageEnvelope>;
}

impl DesktopProtocolEventStream {
    pub async fn recv(
        &mut self,
    ) -> Option<desktop::protocol::DesktopMessageEnvelope>;
}
```

`DesktopProtocolServerHandle` 可 clone，但所有 clone 都连接同一个 server actor；它们不会
创建第二个 Host 或第二个 Agent。`start` 只验证 adapter 配置并启动 server actor，不创建
Session；调用时必须已有 Tokio runtime。server 状态按
`Unhandshaken → Ready → Running → Stopped` 单向推进：

- `Handshake` 不携带 epoch；server 分配 connection epoch 并返回同 request ID 的
  `HandshakeAccepted`；同一 connection 上的重复 handshake 幂等返回原 epoch，不重置
  Session 或 Host；
- 第一条有效 `StartSession` 消耗 one-shot `AgentConfig`，调用一次 `DesktopHost::start`，
  成功后返回 `SessionReady`；
- Host 启动失败返回同 request ID 的 `Rejected(Internal)`，server 随后关闭。R2 不引入
  config factory，也不在同一 server 内暗中重试并创建另一个 Agent；
- 其余 command 只在当前 epoch 与正确 lifecycle state 下路由。合法的 domain rejection
  仍是 protocol response；无法安全关联的结构错误由 `request` 返回 infrastructure error；
- `CancelTurn` 的 accepted turn identity 由 Host actor 原子返回给 crate-private adapter
  method，不通过 `snapshot()` 推断；D1 的 public `cancel_turn() -> Result<(), _>` 不变；
- `Approve` 与 `Deny` 都用 `ApprovalAccepted` 表示“该 decision 已被 Host 接受”，不表示
  decision 一定是 allow；
- `Shutdown` 先让 Host 发布并排空 `Stopped` event，再返回 `ShutdownCompleted`，随后关闭
  server command/event channels。若 event receiver 停止消费导致 forwarder 在 2 秒内无法
  drain，server abort forwarder、返回 infrastructure error 并关闭连接，不伪造成功 response。

所有 response 保留 command `request_id`，不携带 `seq`；所有 event 不携带 `request_id`，
使用 handshake 建立的 epoch 和 EventBuffer 已分配的严格递增 `seq`。R2 不改变 v1 JSON。

D3-PF 的 TypeScript `RenderState` 是唯一产品 UI projection。它只消费
`DesktopMessageEnvelope` 中的 response、event 和 snapshot，负责 draft、conversation、
tool、approval、notice 和 delivery state；它不拥有 Agent、SessionStore 或 approval truth，
也不写 Session Item Log。原 Rust projection 与 Iced UI 已删除。

Tauri slice 已提供 Rust protocol client、bounded in-process
transport、单一 bridge 和 listener-first boot；Host 和 protocol stream 由 composition root
注入，frontend 只发送 protocol intent，不负责 provider bootstrap。完整 Session Chat
界面、Session catalog 与 generation coordinator 后置。

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

D3-PF 的私有 Host protocol adapter 直接把该 envelope 转为 `desktop::protocol` event；不经过
第二套公开 protocol graph。

`request_id` 只匹配 command/response；`seq` 只表示当前 `connection_epoch` 内的 Host
delivery order；snapshot coalesce 和 resync 不改变“不 replay 旧 seq”的语义。

当 snapshot 丢失、worker degraded 或 buffer 无法继续接收时，设置 `resync_required`。
UI 调用 `snapshot()`，以返回的完整状态作为新的基线；不承诺从旧 seq replay。

`DesktopSnapshot` 包含 Session view、host lifecycle state、pending approvals、仍可能有
transient assistant draft 的 `(turn, llm_call_id)` identity 和 `DeliveryStatus`。它不复制
draft 内容；UI 只用 identity 判断本地 draft 是否可以跨 resync 保留：

```rust
pub struct ActiveAssistantCall {
    pub turn: u64,
    pub llm_call_id: String,
}
```

`DeliveryStatus` 结构如下：

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

当前 D3-PF 保持 Host actor 与 Tauri shell 同进程，但 Web intent、response 和 event 全部经过
冻结的 `desktop::protocol` v1 envelope。`connection_epoch`、`request_id` 和 `seq` 的 owner
与 D4 相同。D4 只把 bounded in-process transport 换成 framed child-process transport，
不得重写 shell、frontend projection 或 Agent ownership。

AgentLoop 初期仍是 Agent Host 内的 Tokio task；subagent 先是逻辑 runtime/actor；daemon
是未来独立生命周期的 sibling/service，不作为 Agent 子进程。multi-agent 与 subagent
产品界面不属于 v0.1 Session Chat contract。

完整 owner、协议、重连、resync 和阶段划分见
[`crates/docs/desktop-process-architecture.md`](../docs/desktop-process-architecture.md)。

## 8. 非目标

- D3-PF 尚未实现 Session catalog、Blank/Loaded page identity、first-send transaction、
  New Chat/Session switch 的 fresh-generation lifecycle 或完整 Chat UI；
- Activity Rail、Project Navigator、Content Deck、Agent Dock、Floating Island、
  PTY/Agent Shell、File、Plan 与 Pins 不属于 v0.1；
- 多 Session 并发、多 Agent、后台队列和 scheduler；
- D3-PF 不实现 daemon、server、IPC、sidecar 和跨设备同步；IPC 作为 D4 进程拆分目标，
  daemon 仍以后置独立 runtime 为边界；
- Desktop 直接实现 Session fork、diff 或文件索引；
- 在 `agent-core` 中引入 Tauri、WebView、窗口状态或 UI render object；
- 为每个操作系统复制一套 filesystem/path common library。

详细 ownership、状态机、事件缓冲和关闭顺序见 [`DESIGN.md`](DESIGN.md)。
