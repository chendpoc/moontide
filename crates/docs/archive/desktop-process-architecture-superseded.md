# MoonTide Desktop 进程化架构

> **状态：** 已归档 / superseded（2026-09-01）
> **替代设计：** [`crates/moontide-desktop/DESIGN.md`](../moontide-desktop/DESIGN.md)
> **历史实现设计：** [`crates/desktop/DESIGN.md`](../desktop/DESIGN.md)
> **UI 契约：** [`../desktop/UI-STATE.md`](../desktop/UI-STATE.md)

本文记录已取消的 D4 `moontide-agent-host` / framed process transport 方向，仅供追溯，
不再定义 Desktop 的当前或长期承诺。已确认的新方向是在 `moontide-desktop` 内集成
Tauri shell、runtime coordinator 与 Host actor，并用多个 typed invoke 直连同进程 Host。
旧 D4、`desktop-supervisor`、generic envelope/request correlation 和 transport 可替换性不保留
兼容路径。未来若出现真实跨进程需求，必须重新 Discovery，而不是继续本文的阶段计划。

下文均为历史设计记录；其中事件顺序、snapshot/resync 与 Session Item Log 权威性等仍有效
决定，以替代设计中的重新表述为准。

## 1. 核心结论

```text
┌──────────────────────────────────────┐
│ moontide-desktop                     │
│ Tauri shell + Svelte/TS WebView      │
│ RenderState + protocol client        │
└──────────────────┬───────────────────┘
                   │ Tauri bridge
                   ▼
┌──────────────────────────────────────┐
│ Tauri Rust desktop shell             │
│ window + invoke/event adapter        │
└──────────────────┬───────────────────┘
                   │ versioned desktop protocol
                   ▼
┌──────────────────────────────────────┐
│ moontide-agent-host                  │
│ protocol server + ProcessSupervisor  │
│ AgentSessionRuntime                  │
│   └── AgentLoop Tokio task           │
└──────────────────────────────────────┘
```

目标边界是两个进程，而不是每个逻辑对象一个进程：

- `moontide-desktop` 是 Tauri UI 进程：WebView 前端负责 RenderState 和用户 intent，Tauri Rust shell 负责 window、bridge 和 protocol client；
- `moontide-agent-host` 是 Agent runtime 进程，独占 `Agent`、SessionStore、approval
  和运行生命周期；
- AgentLoop 初期仍是 Agent Host 内的 Tokio task，不默认拆成 OS process；
- Tool 只有在需要权限隔离时才启动受控 subprocess；
- daemon 不是 Agent 的子进程，未来应是独立生命周期的 sibling/service。

当前 D3-PF 由 composition root 在 Tauri binary 内装配
`DesktopProtocolServer → bounded in-process transport → DesktopProtocolClient`。Web intent、
response 和 event 已全部经过 versioned protocol，但 Host actor 仍与 UI shell 同进程。
D4 只替换 transport 并把 Host 移入独立进程，不改变 protocol/client/RenderState contract。

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
        │ Tauri bridge / frontend fold
        ▼
Web frontend RenderState
```

### 2.1 `TurnEvent`

`agent-core` 的 canonical runtime facts。它服务于 Session commit、Agent Event derive、
permission、approval、retry 和 cancellation，不知道 Desktop、Tauri 或 IPC。

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
handle。Tauri WebView 是非 Rust consumer，因此 D3 前必须抽取独立 wire DTO，并提供
TypeScript types/fixtures conformance；不能继续把 in-process canonical Rust value types
当成最终前端 contract。

## 3. Owner 与依赖方向

| Owner | 拥有 | 不拥有 |
|---|---|---|
| `agent-core` | TurnEvent、Session Item Log、AgentLoop 事实语义 | Desktop event、Tauri、IPC |
| `agent` | Agent 装配、Progress、Agent Event Log、provider/tool preset | UI lifecycle、window、protocol transport |
| `agent-host` | Agent、SessionStore、ApprovalBroker、runtime lifecycle | RenderState、WebView widget |
| `desktop::protocol` | command/event/snapshot/error DTO 与版本 | Agent 执行、Session IO、UI layout |
| `desktop` Host | Host actor、EventBuffer、protocol server adapter、Agent runtime ownership | window、Web RenderState |
| Tauri shell | window、bridge、protocol client、连接状态 | Agent、SessionStore、approval truth、Web RenderState |
| Web frontend | RenderState、组件、用户输入 draft、UI 偏好 | Agent、SessionStore、approval truth、Tauri Rust state |
| future daemon | 独立 runtime lifecycle、多客户端/后台任务 | 单个 UI window 的状态 |

当前 D3-PF 与 D4 目标的依赖方向：

```text
moontide-desktop ──────► desktop + Tauri
desktop ───────────────► agent + agent-core（含 `desktop::protocol` wire 模块）
agent-host (D4) ───────► desktop
agent ─────────────────► agent-core + agent-tools
```

`desktop::protocol` 模块不 import Tauri、前端框架、`agent` 或 `agent-core`，避免 wire contract
被实现层反向污染。当前 bounded in-process transport 是 D3-PF 产品路径和测试接缝；Tauri
前端消费独立 wire DTO。D4 将该 transport 替换为 framed child-process IO。

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

`DesktopCommand` 是纯数据 DTO，不包含 oneshot、Tokio channel、Tauri `AppHandle` 或 Host
handle。Host actor 内部 command 可以继续使用 oneshot/channel 实现机制；Tauri 只有一个
typed protocol-command bridge，不得新增绕过 protocol client 的业务 command。

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

当前 D3-PF：

```text
Desktop start
  → construct in-process Host protocol server + client
  → subscribe bridge
  → protocol handshake
  → StartSession / ResumeSession
  → receive Ready + Snapshot
  → frontend starts normal rendering
```

D4 将第一步替换为：

```text
Desktop start
  → spawn/connect agent-host
  → protocol handshake
  → StartSession / ResumeSession
  → receive Ready + Snapshot
  → frontend starts normal rendering
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
| D1 完成 | Host actor、EventBuffer、Snapshot、Approval | UI/Host 同进程 |
| D2 完成 | 冻结可被 WebView 消费的 `desktop::protocol` wire DTO、TS types/fixtures、identity/resync 语义 | 同进程；前端经 Tauri bridge |
| D3-PF 当前 | Tauri single-window shell + Svelte/TypeScript RenderState + protocol client + bounded in-process transport | WebView、Tauri Rust shell 与 Host 同进程，协议边界真实生效 |
| D4 | `agent-host` library + binary，Desktop 通过 framed stdio/pipe 连接 | UI 与 Agent Host 两进程 |
| D5 后置 | standalone runtime daemon、重连、多客户端、多 Session | daemon 独立生命周期 |

D4 之前不实现 TCP loopback、daemon、multi-agent scheduler 或 AgentLoop worker process。

## 8. 验收边界

- Desktop 不直接依赖 `agent-core` 读取文件；
- Web frontend 不拥有 Agent、SessionStore 或 Approval pending truth；
- protocol contract 不暴露 Tauri、前端框架或 Agent runtime ownership 类型；
- Tauri command/event bridge 不绕过 versioned protocol；
- 前端类型与 wire DTO 有可重复的 fixture/conformance 检查；
- 每个 command 有明确 response/request correlation；
- event 顺序仅在 connection epoch 内保证；
- resync 使用 snapshot 建立新基线，不要求旧事件 replay；
- Host 崩溃、UI 断线和 tool cancellation 都有明确 cleanup/恢复语义；
- 当前 D3-PF 同进程 transport 可以被 framed process transport 替换，而无需改变 protocol
  client、Tauri bridge 或 RenderState 契约。

## 9. 明确不做

- 不为 UI、Host、AgentLoop、subagent、daemon 各自创建一个进程；
- 不让 Tauri bridge 或 Web frontend 直接执行 AgentLoop；
- 不让 Web frontend 写 Session Item Log 或 Agent Event Log；
- 不用 Agent Event Log 或 Progress 恢复 Session；
- 不在本阶段实现 daemon、server、远程 worker、TCP RPC 或多 Session scheduler。
