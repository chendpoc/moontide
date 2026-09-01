# Tauri Protocol Boundary Refactor

> **Status:** D3-PF implementation complete on 2026-08-25; D4 remains a separate transport/process batch
> **Mode:** Review-batch implementation with architecture alignment gates
> **Version goal:** D3-PF — protocol-first、同进程 Host 的 Tauri vertical slice
> **Base snapshot:** `feat/assistant-host/r2` at `2cdf850`
> **Implementation status:** R1–R5 committed; R6 implementation, validation and independent review passed
> **Task tracking:** [`tauri-protocol-boundary-refactor-TASKS.md`](tauri-protocol-boundary-refactor-TASKS.md)
> **Note (2026-08-26):** 原独立 `desktop-protocol` crate 已合并为 `desktop::protocol` 模块。下文历史批次仍可能使用旧 crate 名；现行 wire DTO 位于 `crates/desktop/src/protocol/`，fixtures 位于 `crates/desktop/tests/protocol/fixtures/`。

## 1. Problem Statement

MoonTide 已确认 Desktop 的长期边界：Web frontend 拥有 `RenderState` 和用户 intent，
Tauri Rust shell 拥有窗口、最小 capability、typed bridge 与 protocol client，Agent Host
拥有 `Agent`、SessionStore、ApprovalBroker 和 runtime lifecycle。

当前 D3-R2 tracer bullet 已经证明以下最短路径可以运行：

```text
Web frontend → Tauri invoke/event → in-process DesktopHost → Agent
```

但它没有形成目标架构要求的可替换边界：

- Tauri bootstrap 读取环境、构造 `AgentConfig`、选择 Session 并启动 `DesktopHost`；
- host-to-frontend event 使用 `desktop-protocol` envelope，frontend-to-host command
  则通过五个独立 Tauri command 直接调用 `DesktopHostHandle`；
- command 没有真实经过 protocol version、handshake、`request_id` correlation 和 typed
  response；
- `connection_epoch` 被固定为常量，frontend 不检查 epoch、`seq`、`update_index` 或
  snapshot baseline；
- `desktop` 内部 protocol graph、`desktop-protocol` wire graph 和转换层并存；
- Rust `RenderState` 已实现 delivery/resync 不变量，plain JavaScript frontend 又建立了
  一套行为较弱的 projection；
- `ProcessSupervisor` 已存在，但当前 D3 seam 尚不能在 D4 只替换 transport。

因此，继续在当前 bridge 上增加 Session Rail、settings、Inspector 或更多交互，会固化错误
ownership，并使 D4 process split 同时重写 shell、command、state fold 与 lifecycle。

## 2. Goal

在不拆分 Agent Host 进程的前提下，把 D3 重构成完整经过 versioned protocol 的同进程
vertical slice，使 D4 只需要把 in-process transport 替换为 framed child-process transport。

本任务完成后应成立：

```text
Web frontend
  owns RenderState + input draft + UI intent
        │
        ▼
Tauri bridge
  forwards versioned envelopes only
        │
        ▼
Desktop protocol client
  owns request correlation + connection state
        │
        ▼
In-process transport                 D4 replacement point
        │                                  │
        ▼                                  ▼
Host protocol adapter            framed child-process transport
  validates + maps DTOs
        │
        ▼
DesktopHost
  owns Agent + Session + approval + runtime lifecycle
```

## 3. Source of Truth

实现和 review 以以下来源为准，优先级从高到低：

1. 根目录 `AGENTS.md` 与 `UBIQUITOUS_LANGUAGE.md`；
2. 本任务文档中经用户确认的 scope、ownership、acceptance 和 stop conditions；
3. `crates/docs/desktop-process-architecture.md`；
4. [`crates/desktop/README.md`](crates/desktop/README.md) 与 [`DESIGN.md`](crates/desktop/DESIGN.md)（含 `desktop::protocol` 模块）；
5. `crates/desktop/README.md`、`DESIGN.md` 和当前测试；
6. 当前 checkout 的实现代码；
7. `crates/desktop-supervisor` 只作为 D4 已有基础，不作为本任务实现范围。

文档与 live source 冲突时不得静默选择一方：涉及 ownership、公开协议、依赖方向或产品范围
的冲突按 L2/L3 Replan 处理。

## 4. Scope

### 4.1 In scope

- 冻结并验证 `desktop::protocol` v1 的 command、response、event、snapshot、error 和
  delivery identity；
- 建立 host-side protocol adapter，使所有 Web intent 都先成为 protocol command；
- 建立 transport-neutral Desktop protocol client，负责 request correlation、connection
  lifecycle 和 event delivery；
- 提供 D3 in-process transport，连接 protocol client 与现有 `DesktopHost`；
- 将 Tauri shell 收敛为窗口、capability、typed bridge 和 client 注入；
- 将现有 Agent/config/session bootstrap 从 Tauri shell concern 中移出；
- 将 frontend 迁移为 Svelte + TypeScript 的单一 `RenderState` projection，并建立 JSON
  fixture/conformance；
- 实现 boot、handshake、start session、snapshot baseline、event fold、resync、cancel、
  approval 和 graceful shutdown 的完整 vertical slice；
- 删除不再被消费的重复 protocol graph、legacy Rust UI/RenderState 与 Iced 依赖；
- 收紧 Tauri CSP、global API exposure、capability allowlist 和 DOM 渲染。

### 4.2 Allowed paths

实现批次只允许修改下列 concern；每个 Work Packet 还需进一步收窄到具体文件：

- `crates/docs/tauri-protocol-boundary-refactor.md`；
- `crates/docs/desktop-process-architecture.md`；
- `crates/desktop/**`（含 `desktop::protocol` 模块与 fixtures）；
- `crates/moontide-desktop/**`；
- workspace `Cargo.toml`、`Cargo.lock`、`justfile` 中与 Desktop 依赖或验证入口直接相关的行。

### 4.3 Non-goals

- 不创建 `moontide-agent-host` binary，不接入 framed stdio、Unix socket、named pipe 或 TCP；
- 不修改或接入 `desktop-supervisor`；
- 不实现 daemon、后台多客户端、自动重连策略或 UI 退出后继续运行；
- 不实现 multi-agent scheduler、subagent worker process、plugin process 或 tool isolation；
- 不新增 settings UI、Session Rail、workspace tabs、Inspector 完整交互或主题系统；
- 不重新设计 provider、tool permission、Session Item Log 或 Agent Event Log；
- 不在本任务建设完整 Settings Application Module；只移动当前 bootstrap ownership，保持
  现有配置语义，后续由独立 settings refactor 取代；
- 不保留当前五个 Tauri command 的兼容层，除非发现真实外部 consumer；
- 不执行 release build、commit、push 或开 PR，除非用户另行授权。

## 5. Architectural Decisions

### D1. `desktop::protocol` 是唯一跨边界消息契约

`DesktopCommand`、`DesktopResponse`、`DesktopProtocolEvent` 和
`DesktopMessageEnvelope` 的 wire shape 只由 `desktop::protocol` 拥有。Tauri、Svelte、
Agent runtime 和 Tokio ownership 类型不得进入该 crate。

Host 内部可以保留 `HostCommand`、`DesktopEvent` 和 actor channel，但不能再维护第二套
公开 command/response/envelope graph。内部事实到 wire DTO 只允许有一个 host-side
adapter。

### D2. Protocol client 与 transport 分离，但当前不新增共享 crate

protocol client 负责：

- 分配唯一 `request_id`；
- 管理 pending request；
- 执行 handshake 与 Session boot gate；
- 校验 response correlation；
- 发布 event 与 connection state；
- 断线时结束 pending request；
- 触发 snapshot resync。

transport 只负责发送和接收完整 envelope。D3 使用同进程 channel；D4 才替换成 framed
child-process transport。

当前只有 Tauri 一个 client consumer，因此 client 先作为 `moontide-desktop` 的纯 Rust
内部模块存在，不提前抽取 `desktop-client` crate。出现第二个真实 consumer 后再评估抽取。

### D3. 同进程不等于绕过协议

D3 可以继续让 Host 与 Tauri 位于同一 OS process，但所有 frontend command、response 和
event 必须经过与 D4 相同的 `desktop::protocol` envelope。不得根据 transport 类型提供
直接调用 `DesktopHostHandle` 的 UI 快路径。

### D4. Tauri shell 不拥有 Agent bootstrap

应用 composition root 可以继续在 D3 同一 binary 中读取现有环境并启动 in-process Host，
但必须先完成 runtime/client 组装，再把 protocol client 注入 Tauri shell。

Tauri setup、command handler 和 window event handler 不得构造 `AgentConfig`、选择 Session、
复制 tool preset 或直接保存 `DesktopHostHandle`。D4 时 composition root 改为启动
`ProcessSupervisor`/child transport，不改变 shell contract。

本任务不解决现有配置重复；它只确保重复不再由 Tauri shell 拥有。

### D5. Web frontend 拥有唯一产品 RenderState

TypeScript `RenderState` 是正式 Web UI projection。它只消费 protocol response、event 和
snapshot，不拥有 Agent、SessionStore 或 approval truth。

Rust `RenderState` 及其现有测试在迁移期间作为行为 oracle，用同一组 JSON fixtures 对照：

- snapshot 按 `(turn, llm_call_id)` 和 `update_index` 替换；
- stale seq/update 忽略；
- seq gap、未知 ToolResult 或显式 marker 请求 resync；
- 新 epoch 必须先建立 snapshot baseline；
- snapshot 期间暂存 event，baseline 后按 seq 重放；
- finalized assistant 不被旧 snapshot 重新打开；
- completion、failure、approval 和 stopped 正确收敛 UI state。

TypeScript parity 达成并完成独立 review 后，删除 legacy Rust UI/RenderState，避免双 source
of truth。若 Rust projection 出现新的非 UI consumer，必须暂停删除并回到架构 review。

### D6. Request identity 与 delivery identity 严格分离

- command 必须有 `request_id`，不得有 `seq`；
- response 必须回显原 `request_id`，不得参与 event gap 判断；
- event 必须有当前 `connection_epoch` 和严格递增 `seq`，不得伪造 `request_id`；
- handshake 前 epoch 可以为空；handshake 成功后由 connection owner 分配真实 epoch；
- epoch 不得由 UI 提供，也不得固定写死；
- resync 建立新 snapshot baseline，不 replay 旧 epoch 的事件。

### D7. Domain rejection 与 transport failure 分离

- Host 对 Busy、NoActiveTurn、ApprovalNotFound、Stopping 等返回 typed rejected response；
- protocol version、message kind、缺失 identity 等违反协议的输入在 protocol adapter 拒绝；
- JSON/bridge/channel 失败是 connection/transport error，不伪装成 Agent domain error；
- connection 关闭时 client 统一失败所有 pending request，并让 frontend 进入 Disconnected；
- frontend 不根据错误字符串推断恢复策略。

### D8. Boot 与 shutdown 是协议流程

Boot 顺序固定为：

```text
create client → subscribe bridge → handshake → start/resume Session
→ receive SessionReady snapshot → establish delivery baseline → render events
```

订阅建立前不得启动会丢失事件的 Host pump。snapshot response 进行期间到达的 event 必须缓冲。

Shutdown 顺序固定为：

```text
window close intent → protocol Shutdown → reject new commands
→ cancel active Turn → cleanup approval → flush → Stopped
→ ShutdownCompleted → close transport/window
```

窗口强制退出或 Host/transport 异常关闭必须产生可观察的 degraded result，不能静默 detach。

### D9. Tauri bridge 只有一个业务入口

Web frontend 只向 Tauri 发送已类型化的 `DesktopCommand` intent，不构造 request ID、epoch、
seq 或 command envelope。Rust protocol client 分配唯一 `request_id`，按自身 handshake state
注入 epoch，并将完整 command envelope 交给 transport；Tauri bridge 返回完整 response
envelope，event pump 发布完整 event envelope。`submit_turn`、`cancel_turn`、`approve`、`deny`、
`fetch_snapshot` 等独立业务 command 不再作为 bridge API。

该澄清于 2026-08-25 经用户确认：D9 中“typed protocol command”指
`desktop::protocol::DesktopCommand` value，而非 UI 自行构造的 `DesktopMessageEnvelope`。
因此 D2/D6 的 identity ownership 保持不变，WebView 无法伪造 connection identity。

Tauri capability 只允许该入口、必要的 event subscription 和 window close。WebView 不获得
通用 event emit、任意 process spawn、filesystem 或 shell 权限。

### D10. Security baseline 属于 D3 acceptance

- 关闭不必要的 global Tauri API；
- 配置非空 CSP；
- 所有动态文本使用安全 DOM/text rendering，不使用未转义 `innerHTML`；
- API key、prompt、tool output 和完整 diagnostic payload 不进入 Tauri log；
- command envelope 在 Rust host boundary 重新校验，不信任 TypeScript narrowing；
- capability 和 command surface 通过静态检查或 fixture 守门。

## 6. Target Module Ownership

| Module | Owns | Must not own |
|---|---|---|
| `desktop::protocol` | Wire DTO、version、identity、serialization fixtures | Agent、IO、Tauri、Tokio channel、RenderState |
| `desktop` host internals | Host actor、Agent、Session query、ApprovalBroker、EventBuffer | Tauri、Web state、cross-process transport |
| `desktop` host protocol adapter | Wire validation、command mapping、response/event mapping | Window、frontend state、process lifecycle |
| `moontide-desktop` composition root | D3 runtime assembly、current config source、client injection | UI projection、Session facts |
| protocol client | Request correlation、connection state、boot/resync gate | AgentConfig、SessionStore、window layout |
| in-process transport | Envelope movement and closure | Domain decisions、DTO conversion |
| Tauri shell/bridge | Window、minimal capability、envelope forwarding | Host handle、AgentConfig、Session selection、RenderState |
| TypeScript frontend | RenderState、local input/UI preferences、intent | Agent、approval truth、Session persistence |

目标依赖方向：

```text
frontend ──JSON shape──► desktop::protocol
Tauri bridge/client ───► desktop::protocol
in-process composition ─► desktop host adapter ─► agent
desktop host adapter ───► desktop::protocol
desktop::protocol ───────► serde only
```

禁止形成：

```text
frontend/Tauri handler ─► DesktopHostHandle
desktop::protocol ───────► agent / agent-core / Tauri
Tauri shell ────────────► AgentConfig / SessionStore
```

## 7. Migration Plan

每个 commit 必须保持 workspace 可编译，测试行为不得依赖后续 commit 才恢复。具体 commit
message 在实施时按 `{feat,fix,docs}[(scope)]: …` 生成；以下是逻辑提交边界，不是提交授权。

### Work Packet R0 — Freeze the contract and evidence

**Goal:** 在改变调用路径前，让 wire shape 和当前关键行为可重复验证。

1. **Add this canonical task document.**
   - 只增加计划文档和必要索引；
   - 不改代码、Cargo 依赖或现有 Desktop docs 的状态声明。

2. **Add committed protocol JSON fixtures.**
   - 覆盖 handshake、start session、submit、cancel、approval、snapshot、shutdown；
   - 覆盖 accepted/rejected response、streaming snapshot、tool、approval、failure、resync、
     stopped event；
   - Rust test deserialize/serialize fixtures，并检查 envelope identity invariants；
   - fixture 不包含 secrets、绝对用户路径或不稳定时间值。

3. **Document protocol v1 validation rules without changing shape.**
   - 明确 command/response/event 对 `request_id`、epoch、seq 的要求；
   - 明确未知 version、错误 payload kind 和过大 frame 的处理；
   - 若 fixture 暴露必须修改 JSON shape 的缺陷，停止并请求 protocol version 决策。

**Acceptance:** `cargo test -p desktop`（含 protocol fixtures）；fixture diff 可独立 review。

### Work Packet R1 — Build the host protocol adapter

**Goal:** 让现有 `DesktopHost` 可以只通过 wire envelope 被驱动。

4. **Add protocol validation and handshake adapter.**
   - adapter 接收 `desktop::protocol` command envelope；
   - 拒绝错误 version、缺失 request ID、command 携带 seq、非 command payload；
   - handshake response 回显 request ID，并建立 connection epoch；
   - 使用 fake/in-memory Host boundary 测试，不接 Tauri。

5. **Route Session boot and Snapshot through the adapter.**
   - 将 `StartSession` 映射到现有 create/resume lifecycle；
   - `SessionReady` 和 `Snapshot` 都返回完整 baseline；
   - handshake 之前拒绝 Session command；重复 start 返回 typed rejection；
   - snapshot 不改变 Session Item Log。

6. **Route turn, cancellation and approval commands.**
   - 映射 Submit、Cancel、Approve、Deny；
   - 统一转换 `DesktopCommandError` 到 rejected response；
   - 保证 Busy、NoActiveTurn、approval uniqueness 和 empty input 的现有不变量；
   - 每个 response 保留原 request ID。

7. **Route shutdown and connection closure.**
   - Shutdown 使用现有 Host cleanup 顺序；
   - 完成 response 与 Stopped event 的可观察顺序写入测试；
   - channel/stream 异常关闭不转换为成功 response。

8. **Emit wire events directly from the host-side adapter.**
   - 保留 EventBuffer 分配的 seq；
   - 注入 adapter 拥有的 epoch；
   - event 不携带 request ID；
   - snapshot coalescing、control-event retention 和 resync marker 行为保持不变。

**Acceptance:** focused adapter/Host tests通过；现有 `desktop` tests 不退化；Tauri 仍可保持
旧路径运行，尚不删除兼容代码。

### Work Packet R2 — Introduce client and rewire Tauri

**Goal:** 在同进程内建立未来 D4 可替换的 client/transport seam。

9. **Add a transport-neutral protocol client.**
   - 使用 fake transport 测试 request ID allocation、pending response、unknown response、
     connection close 和 event subscription；
   - client API 只暴露 protocol intent/result，不暴露 Host handle；
   - 不抽取新 workspace crate。

10. **Add the in-process transport.**
    - 只移动完整 envelope；
    - 连接 client 与 R1 host adapter；
    - 端到端测试 handshake → start session → snapshot → submit → cancel/shutdown；
    - 测试 transport 替换不改变 client 和 frontend contract。

11. **Separate application composition from Tauri shell setup.**
    - composition root 暂时保留当前 provider/config/session 语义；
    - 先启动 host adapter/client，再向 shell 注入 client；
    - Tauri shell 删除 `AgentConfig`、tool preset、Session selection 和 `DesktopHostHandle`
      import；
    - 不在本 commit 改 settings 产品行为。

12. **Replace direct Tauri business commands with the envelope bridge.**
    - frontend command 只经过一个 allowlisted bridge entry；
    - response/event 都返回完整 envelope；
    - 删除五个 direct Host command handler 和对应 capability；
    - bridge error 只表示 serialization/transport failure，domain rejection 保留在 response。

13. **Wire graceful window close through protocol shutdown.**
    - 正常 close 等待 shutdown completion；
    - 超时/transport failure 显示 degraded shutdown evidence；
    - 不在 D3 接入 `ProcessSupervisor` kill escalation。

**Acceptance:** Tauri Rust code不再直接调用 `DesktopHostHandle`；静态 dependency/import 检查
守门；Rust in-process end-to-end 测试通过。

### Work Packet R3 — Establish the TypeScript RenderState

**Goal:** 让 Web frontend 成为唯一 UI projection，并复现已确认的 delivery semantics。

14. **Add the minimal Svelte + TypeScript test/build baseline.**
    - 只建立 frontend entry、typecheck、unit test 和 dev build；
    - 不重新设计视觉样式或扩大产品功能；
    - package scripts 提供稳定的 `check`、`test` 和 `build` 入口。

15. **Consume protocol fixtures from TypeScript.**
    - TypeScript 类型与 Rust fixture conformance 同批建立；
    - fixture 必须覆盖所有 top-level command/response/event variants；
    - 不手写第二套具有不同字段语义的 DTO。

16. **Port RenderState model and pure fold.**
    - 先移植 Rust tests 已覆盖的 projection invariants；
    - fold 不 import Tauri、Svelte component 或 DOM；
    - reducer tests 只验证外部 envelope → view state 行为。

17. **Add boot, snapshot buffering and resync orchestration.**
    - listener 先于 handshake/start session 建立；
    - snapshot pending 期间缓冲 event；
    - baseline 后按 seq 重放并忽略已包含的 stale event；
    - gap、新 epoch、unknown ToolResult 和 explicit marker 触发 snapshot；
    - resync 失败进入 Disconnected/Failed，不循环无界重试。

18. **Port the minimal conversation UI to RenderState.**
    - conversation、composer、streaming assistant、tool/approval/error/stop 只读取
      `RenderState`；
    - component 只发 intent，不直接调用多个 Tauri business command；
    - 保留当前 D3-R2 用户可见行为，不增加 Session Rail/settings/Inspector。

19. **Apply the Tauri/Web security baseline.**
    - 去除不需要的 global Tauri object 和 event emit permission；
    - 配置 CSP；
    - 删除动态 `innerHTML`；
    - 加入 capability/config 静态检查和 smoke checklist。

**Acceptance:** frontend typecheck、unit tests、fixture conformance 和 production build 通过；
手工 smoke 覆盖启动、流式输出、cancel、approval、resync 和 close。

### Work Packet R4 — Remove transitional architecture

**Goal:** 在新链路有同等或更强证据后删除双重 ownership 和遗留依赖。

20. **Remove the parallel `desktop` public protocol graph.**
    - 只保留 internal Host facts/channel 与唯一 wire adapter；
    - 删除 command/response/envelope 的重复公开类型和双跳 conversion；
    - 若发现 workspace 外真实 consumer，暂停并请求兼容策略，不默认加 shim。

21. **Remove legacy Rust UI/RenderState after parity review.**
    - 先证明所有 Rust behavior cases 已在 TypeScript fixture tests 中覆盖；
    - 删除 legacy UI module、Rust projection 和 Iced dependency；
    - 保留 Host/EventBuffer/adapter 的 Rust tests；
    - 不删除仍承载 runtime 不变量的测试。

22. **Tighten dependency direction.**
    - `desktop::protocol` 保持 serde-only；
    - Tauri shell/bridge 模块只依赖 protocol client 与 Tauri；
    - `desktop` 对 `agent-core` 的直接 production dependency 若仅由转换层引入，则把转换
      ownership 移到 host adapter 能使用的最窄边界，并重新评估是否可移除；
    - 删除未使用依赖和 temporary exports。

23. **Update architecture and crate documentation.**
    - 将 D3-PF 标记为当前实现；
    - 清晰区分 D3 in-process transport 与 D4 process split；
    - README 的运行说明不再把 direct invoke/Host path 描述为目标架构；
    - 记录 D4 只替换 transport 的剩余前置条件。

24. **Run focused and workspace validation.**
    - 先运行各模块 focused checks；
    - 再运行 `just check`；
    - 报告 Tauri/macOS toolchain、frontend package manager 或 sandbox 限制；
    - 生成 Implementation Evidence 和独立 Standards/Spec Review Report。

## 8. Testing Decisions

### 8.1 Test observable contracts, not implementation layout

测试以完整 envelope、可观察状态和 lifecycle result 为输入/输出，不断言私有 channel、task
数量、函数拆分或 Svelte component 内部结构。重命名模块不应导致行为测试失效。

### 8.2 Existing prior art to preserve

- `desktop::protocol` 已有 JSON round-trip、streaming snapshot 和 frame-size tests；
- `desktop::event` 已覆盖 snapshot coalescing、control order、overflow 和 resync marker；
- `desktop::host` 已覆盖 start/snapshot/shutdown 和 Busy；
- 已删除的 Rust `desktop::render_state` 曾覆盖 seq gap、new epoch、snapshot baseline、assistant
  finalize、orphan ToolResult、approval、failure 和 recoverability；这些场景已在删除前迁移为
  TypeScript parity tests。

前三类 Rust tests 继续作为 runtime 回归守门；已删除 projection 的行为由 TypeScript parity
matrix 和冻结 fixtures 持续守门。

### 8.3 Required new test matrix

| Boundary | Required evidence |
|---|---|
| Protocol DTO | All top-level variants fixture round-trip; identity validation |
| Host adapter | Version/handshake gate; every command mapping; typed rejection; response correlation |
| Event delivery | Epoch/seq; coalescing; gap/resync; no request ID on events |
| Client | Unique request IDs; pending map; unknown/stale response; disconnect cleanup |
| In-process transport | Full boot and shutdown; command/response/event race |
| TypeScript fold | Rust parity fixtures; snapshot buffering; stale/gap/new epoch behavior |
| Tauri bridge | One allowlisted business entry; no direct Host handle; minimized capabilities |
| Security | CSP present; global API minimized; no dynamic unescaped HTML |
| Smoke | New Session, streaming, cancel, approval, failure/resync, graceful close |

### 8.4 Validation order

每个 Work Packet 先运行最小 focused test，再扩大：

1. `cargo test -p desktop`；
2. `cargo test -p desktop`；
3. frontend typecheck/unit test/build scripts；
4. `cargo test -p moontide-desktop` 或等价 Tauri library check；
5. `cargo fmt --all --check`；
6. `cargo clippy --workspace --all-targets`；
7. `cargo test --workspace`；
8. `just check` 作为最终 workspace gate；
9. `cargo tauri dev` 仅作为需要真实 WebView/credential 的手工 smoke，不替代自动化测试。

## 9. Acceptance Criteria

### Architecture

- Tauri shell、bridge 和 frontend 不 import 或保存 `DesktopHostHandle`；
- Tauri shell 不构造 `AgentConfig`、不解析 settings、不选择 Session；
- frontend-to-host command 与 host-to-frontend response/event 全部使用
  `desktop::protocol::DesktopMessageEnvelope` 的 JSON shape；
- `desktop::protocol` 不依赖 Agent、Agent Core、Tauri、Tokio 或 frontend framework；
- D3 in-process transport 可以被 fake transport 替换，而无需修改 client、bridge 或
  `RenderState` contract；
- 不存在两个公开 command/response/envelope graph；
- 产品 UI 只有一个 `RenderState` implementation。

### Behavior

- boot 必须完成 handshake 和 SessionReady snapshot 后才进入正常 event fold；
- 每个 command 都有唯一 request ID 和 exactly-one terminal response；
- response correlation、event seq 和 Session Item `seq` 不混用；
- event gap、新 epoch、buffer degradation 和未知 projection fact 都能进入 resync；
- snapshot 建立新 baseline，不 replay 旧 epoch；
- active Turn cancel、approval resolve、failure 和 shutdown 保持现有 Host 语义；
- transport failure 不被显示为业务成功，domain rejection 不被降级为字符串推断。

### Security and operations

- WebView 没有通用 process/filesystem/shell capability；
- Tauri capability 只暴露单一 envelope bridge、必要 event subscription 和 window lifecycle；
- CSP 非空，动态协议内容不通过未转义 `innerHTML` 渲染；
- protocol/event/log 不包含 API key；
- focused tests、frontend checks、workspace `just check` 和手工 smoke 都有可复现证据。

## 10. Risks and Mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| 当前 dirty Desktop work 与实施重叠 | 覆盖其他会话工作或错误基线 | 设计 review 后先明确保留/替换哪些 dirty files；不 reset/stash/clean |
| Response 与 event race | snapshot baseline 回退或伪造 gap | listener-first boot、buffer-during-snapshot、race tests |
| 双 protocol graph 长期共存 | conversion 漂移和错误 ownership | R4 是完成条件，不把 transitional graph 视为最终态 |
| Rust/TS RenderState 行为漂移 | Web UI 在 gap/resync 时显示错误事实 | shared fixtures、parity matrix、删除前独立 review |
| D3 过早引入 D4 lifecycle | 扩大 scope、延迟 vertical slice | transport interface 只覆盖当前 envelope movement；不接 supervisor |
| Bootstrap 移动顺带重做 settings | 把两个架构重构耦合 | 保持当前配置语义；Settings Application Module 独立计划 |
| Frontend migration 变成 UI redesign | 验收不可控 | 保留当前最小交互；视觉与 Session Rail 明确 out of scope |
| 删除 public Rust protocol exports | 未知 consumer breakage | workspace/source search + user design gate；无真实 consumer 时不加兼容层 |
| Security tightening 阻断 dev workflow | 本地启动失败 | capability/CSP 每步加入 smoke；不在末尾一次性收紧 |

## 11. Stop Conditions

出现以下情况时暂停受影响 Work Packet 并请求用户决定：

- 需要修改 `desktop::protocol` v1 的现有 JSON shape 或提升 protocol version；
- 需要改变 Agent、SessionStore、ApprovalBroker、Session Item Log 的 ownership；
- 需要修改 Session persistence 格式或 Agent public contract；
- D3 无法在不创建 `agent-host` process 的情况下满足 protocol/client seam；
- 发现 workspace 外真实 consumer 依赖待删除的 `desktop` public protocol 或 Rust
  `RenderState`；
- 必须扩大到 settings product behavior、Session Rail、daemon、multi-agent 或 plugin process；
- 当前 dirty worktree 中出现无法安全区分的并行修改；
- focused tests 暴露现有 Host 行为与已确认文档冲突。

## 12. Review and Delivery Gates

1. [x] 用户已于 2026-08-25 完成本任务文档的 architecture/design review；
2. [x] 用户已确认两个删除目标：重复 `desktop` public protocol graph，以及 TypeScript
   parity 后的 legacy Rust UI/RenderState；
3. 每个 Work Packet 开始前建立独立 scope、allowed files、acceptance 和 stop conditions；
4. 实现后提供 focused/workspace validation evidence；
5. 独立 Standards Review 检查 AGENTS、handbook、术语、分层与错误语义；
6. 独立 Spec Review 检查本任务目标和 acceptance；
7. 用户完成最终 diff review；
8. 只有用户明确说 `commit` 后才提交。

## 13. Completion Definition

本 refactor 只有在以下条件同时满足时完成：

- D3 真实运行路径为 protocol-first，而不是文档声明；
- 直接 Tauri business command → HostHandle 路径已删除；
- Tauri shell 只接收 protocol client；
- TypeScript `RenderState` 完整覆盖已确认的 delivery/resync semantics；
- transitional duplicate protocol 与 legacy projection 已删除或经用户明确决定保留；
- D4 process split 可以被描述为“替换 transport + 接入 ProcessSupervisor”，而不是重写
  frontend、bridge、client 和 state contract；
- 所有验证证据、残余风险和未完成 D4 前置条件已写入任务文档或 Implementation Evidence。
