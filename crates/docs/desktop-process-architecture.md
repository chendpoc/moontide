# MoonTide Desktop 进程化架构

> **状态：** 已确认的目标架构；当前 D1 仍为同进程 Host 基线，IPC 与进程拆分尚未实现。
> **当前实现：** [`crates/desktop/DESIGN.md`](../desktop/DESIGN.md)
> **UI 契约：** [`../desktop/UI-STATE.md`](../desktop/UI-STATE.md)

本文定义 Desktop UI、Desktop protocol 与 Agent runtime 的长期边界。它不实现 IPC、
daemon 或多 Agent，只冻结 owner、依赖方向、消息语义和演进顺序。

## 1. 核心结论

```text
┌──────────────────────────────────────┐
│ moontide-desktop                     │
│ Iced UI + RenderState + protocol     │
│ client                               │
└──────────────────┬───────────────────┘
                   │ Desktop protocol
                   ▼
┌──────────────────────────────────────┐
│ moontide-agent-host                  │
│ protocol server + HostSupervisor     │
│ AgentSessionRuntime                  │
│   └── AgentLoop Tokio task           │
└──────────────────────────────────────┘
```

目标边界是两个进程，而不是每个逻辑对象一个进程：

- `moontide-desktop` 是 UI 进程，只负责 Iced window、RenderState 和用户 intent；
- `moontide-agent-host` 是 Agent runtime 进程，独占 `Agent`、SessionStore、approval
  和运行生命周期；
- AgentLoop 初期仍是 Agent Host 内的 Tokio task，不默认拆成 OS process；
- Tool 只有在需要权限隔离时才启动受控 subprocess；
- daemon 不是 Agent 的子进程，未来应是独立生命周期的 sibling/service。

当前 D1 的 `crates/desktop` 同时包含 Host contract 和 Host actor，运行在同一进程。
这是实现基线，不是最终的 UI/runtime 进程边界。

## 2. 三层事件语义

Desktop 需要自己的 UI-facing event contract，但不能复制 Agent core 的事实事件：

```text
agent-core::TurnEvent
        │ derive
        ▼
agent::ProgressEvent
        │ adapt / serialize
        ▼
DesktopProtocolEvent
        │ fold
        ▼
Iced RenderState
```

### 2.1 `TurnEvent`

`agent-core` 的 canonical runtime facts。它服务于 Session commit、Agent Event derive、
permission、approval、retry 和 cancellation，不知道 Desktop、Iced 或 IPC。

### 2.2 `ProgressEvent`

`agent` 面向宿主的语义投影。CLI、Desktop 和 headless consumer 可以使用，但它不是跨
进程 wire contract。

### 2.3 `DesktopProtocolEvent`

Desktop UI 的稳定 DTO，负责表达：

- host lifecycle state；
- assistant draft snapshot；
- ToolCall / ToolResult view payload；
- approval request；
- turn completion/failure；
- process connection、resync 和 stopped 状态；
- 当前连接内的 `seq` 与 `connection_epoch`。

Desktop protocol 不直接公开 Agent runtime 的 ownership / implementation 类型，例如
`agent::ProgressEvent`、`agent::ModelResponse`、`Agent`、`SessionStore` 或 observer/task
handle。这个规则是最终跨进程 wire boundary 的约束，不要求 D1/D3 立即复制所有
canonical value payload；in-process adapter 可以继续复用已经稳定的 `ToolCall`、
`ToolResult`、`ContentBlock` 和 `ModelResponseSnapshot`。只有在 D4 有真实 framed
transport、独立版本或非 Rust consumer 时，才抽取必要的独立 payload DTO。

## 3. Owner 与依赖方向

| Owner | 拥有 | 不拥有 |
|---|---|---|
| `agent-core` | TurnEvent、Session Item Log、AgentLoop 事实语义 | Desktop event、Iced、IPC |
| `agent` | Agent 装配、Progress、Agent Event Log、provider/tool preset | UI lifecycle、window、protocol transport |
| `agent-host` | Agent、SessionStore、ApprovalBroker、runtime lifecycle | RenderState、Iced widget |
| `desktop-protocol` | command/event/snapshot/error DTO 与版本 | Agent 执行、Session IO、UI layout |
| `desktop` | Iced window、RenderState、用户 intent、连接状态 | Agent、SessionStore、approval truth |
| future daemon | 独立 runtime lifecycle、多客户端/后台任务 | 单个 UI window 的状态 |

目标 crate 依赖方向：

```text
desktop ───────────────► desktop-protocol
agent-host ────────────► desktop-protocol
agent-host ────────────► agent
agent ─────────────────► agent-core + agent-tools
desktop-protocol ──────► serde / protocol dependencies only
```

最终的 `desktop-protocol` 不依赖 Iced、`agent` 或 `agent-core`，避免 wire contract 被
实现层反向污染。当前 D1/D3 可以暂时由 `desktop` 内部实现顶层 contract，并通过
in-process adapter 复用 canonical value payload；D4 进程拆分前，再按实际 transport
需求抽出必要的共享 payload DTO。

## 4. Desktop protocol

### 4.1 Command

UI 发送 intent，Host 重新校验并决定是否执行：

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
```

`ApprovalId`、turn identity、Session identity 和权限事实由 Host 产生或校验，UI 不得
自行构造执行事实。

`DesktopCommand` 在最终协议中是纯数据 DTO，不包含 oneshot、Tokio channel 或 Host
handle。D1 的内部 command 可以继续使用这些实现机制，但不得把它们提升为协议 API。

### 4.2 Response 与 event

```rust
pub struct DesktopMessageEnvelope {
    pub protocol_version: u16,
    pub request_id: Option<String>,
    pub connection_epoch: Option<u64>,
    pub seq: Option<u64>,
    pub payload: DesktopMessage,
}
```

`request_id` 匹配 command response；握手前 `connection_epoch` 为空，握手建立后
`seq` 只在当前 `connection_epoch` 内有序。消息 payload 至少包含 typed command error、
`DesktopEvent` 和 `DesktopSnapshot`。

当前已确认的事件语义：

- snapshot 按 `(turn, llm_call_id)` 替换，不追加重复 draft；
- control event 与 snapshot 共用一个有序 buffer；
- approval、completion、failure、stopped 不主动丢弃 snapshot 以外的事实；
- 发生丢失或连接重建时，UI 先消费 `DesktopSnapshot`，再建立新的本地事件基线；
- 不承诺从旧 `seq` replay；
- API key 不进入 event、snapshot 或诊断 payload。

### 4.3 Snapshot

`DesktopSnapshot` 是恢复的完整基线，至少包含：

- Session history/query result；
- Host lifecycle state；
- pending approvals；
- delivery/resync status；
- 当前仍可证明有效的 transient assistant draft identity（`turn` + `llm_call_id`，若存在）；
  draft 内容仍由 UI 本地 RenderState 持有。

Session Item Log 是历史事实源；Progress、EventBuffer 和 RenderState 都不能替代它。

## 5. 进程生命周期

### 5.1 Desktop 启动

```text
Desktop start
  → spawn/connect agent-host
  → protocol handshake
  → StartSession / ResumeSession
  → receive Ready + Snapshot
  → Iced starts normal rendering
```

Host handshake 失败、protocol version 不匹配或 Session 恢复失败时，UI 显示 typed
connection/startup error，不自行创建第二个 Agent。

### 5.2 UI 断线与重连

```text
connection lost
  → UI enters Disconnected
  → host remains authoritative if still alive
  → reconnect
  → new connection_epoch
  → Snapshot
  → reset local RenderState baseline
  → consume new events
```

第一版子进程模式可以采用“Desktop 退出即请求 Host shutdown”；只有明确需要 UI 关闭后
继续运行时，才把 Host 提升为独立 daemon-like service。

### 5.3 Host 关闭

```text
Shutdown command
  → reject new commands
  → cancel active turn
  → await AgentLoop cleanup
  → cancel pending approvals
  → flush Progress
  → flush Agent Event Log
  → publish Stopped
  → close transport
```

异常断线不能跳过 Host 的 cleanup。Host 仍以 Session Item Log 为恢复依据。

## 6. Subagent、worker 与 daemon

### Subagent

Subagent 首先是 runtime 内的逻辑对象或 actor：

```text
AgentSessionRuntime
  ├── MainAgent
  └── SubagentRuntime
```

只有出现不可信代码隔离、独立资源配额、崩溃隔离、远程执行或独立升级需求时，才将
subagent 提升为 worker process。

### AgentLoop

AgentLoop 是 Agent Host 内的 Tokio task。将它拆成 OS process 会增加 command routing、
Session ownership、cleanup 和诊断链路复杂度；当前没有足够消费者证明该成本合理。

### Tool subprocess

bash 等工具可以是受 permission broker 控制的子进程，但它们不是 Agent Host 的第二个
runtime。Host 负责启动、取消、回收和记录 tool result。

### Daemon

daemon 是独立生命周期的 runtime service，不应挂在某一个 Agent process 下面：

```text
desktop ───────► runtime daemon
cli ───────────► runtime daemon
other frontend ► runtime daemon
```

daemon 后置到出现后台运行、多客户端、UI 崩溃后重连或多 Session 并发等明确需求之后。

## 7. 演进阶段

| 阶段 | 内容 | 进程边界 |
|---|---|---|
| D1 当前 | Host actor、EventBuffer、Snapshot、Approval | UI/Host 同进程 |
| D2 | 冻结顶层 `desktop-protocol` contract，定义 identity/resync 语义，增加 in-process transport adapter | 仍同进程；不强制复制全部 canonical payload |
| D3 | Iced single-window UI + RenderState | UI 仍可使用 in-process adapter |
| D4 | `agent-host` library + binary，Desktop 通过 framed stdio/pipe 连接 | UI 与 Agent Host 两进程 |
| D5 后置 | standalone runtime daemon、重连、多客户端、多 Session | daemon 独立生命周期 |

D4 之前不实现 TCP loopback、daemon、multi-agent scheduler 或 AgentLoop worker process。

## 8. 验收边界

- Desktop 不直接依赖 `agent-core` 读取文件；
- UI 不拥有 Agent、SessionStore 或 Approval pending truth；
- protocol contract 不暴露 Iced 或 Agent runtime ownership 类型；D1/D3 可以复用稳定的 canonical value payload；
- 每个 command 有明确 response/request correlation；
- event 顺序仅在 connection epoch 内保证；
- resync 使用 snapshot 建立新基线，不要求旧事件 replay；
- Host 崩溃、UI 断线和 tool cancellation 都有明确 cleanup/恢复语义；
- 当前 D1 同进程实现可以被 transport adapter 替换，而无需改变 RenderState 契约。

## 9. 明确不做

- 不为 UI、Host、AgentLoop、subagent、daemon 各自创建一个进程；
- 不让 Desktop 直接执行 AgentLoop；
- 不让 UI 写 Session Item Log 或 Agent Event Log；
- 不用 Agent Event Log 或 Progress 恢复 Session；
- 不在本阶段实现 daemon、server、远程 worker、TCP RPC 或多 Session scheduler。
