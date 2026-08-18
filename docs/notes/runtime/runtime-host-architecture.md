# MoonTide Runtime Host 架构候选

> **状态：** Candidate
> **性质：** 技术架构讨论记录，不覆盖当前 Rust 契约。
> **当前基线：** [`AGENTS.md`](../../../AGENTS.md)、[`crates/docs/engineering-handbook.md`](../../../crates/docs/engineering-handbook.md)、[`docs/product/desktop-development-direction.md`](../../product/desktop-development-direction.md)。

## 1. 结论摘要

MoonTide 采用“独立产品产物、渐进式进程化”的路线：

1. `agent-core` 保持纯内核，不包含 CLI、Slint、server 或进程调度。
2. `agent` 保持组合根，暴露宿主 API 和语义进度事件。
3. CLI 与 Desktop 是独立 Cargo package 和独立产物，不用 feature/cfg 在同一 crate 内切换产品形态。
4. 当前先保持进程内执行，完成宿主事件和前端边界。
5. 只有出现长时间运行、UI attach、崩溃恢复或多 Session 并发需求时，才引入 Runtime Host、Agent Worker 和 IPC。
6. Server/headless 暂不实现；未来作为独立 frontend 子进程接入 Runtime Host。

“独立产物”不等于“立即拆成多进程”。先拆依赖边界，再按真实故障和生命周期需求拆进程。

## 2. 目标产物与依赖

当前和后续产物关系：

```text
agent-core
  └─ Turn / Session / Tool / LLM / Event / Context / Loop

agent-tools
  └─ 第一方工具 catalog 和 executor

agent
  └─ provider、preset、Agent facade、ProgressEvent、Session 宿主 API

cli-frontend       ─┐
desktop-frontend   ─┼─► agent ► agent-core
server-frontend    ─┘     （未来）

runtime-host ─► agent-worker ─► agent
    （未来）
```

职责边界：

| 组件 | 负责 | 不负责 |
|---|---|---|
| `agent-core` | 执行层级、Session 事实、工具和模型协议 | UI、终端、Slint、进程管理 |
| `agent` | 组合运行时、宿主事件、Session 查询 | 具体 UI 渲染 |
| `cli-frontend` | REPL、终端输入、stdout/stderr、RenderState | AgentLoop、Session JSONL |
| `desktop-frontend` | Slint 状态、窗口生命周期、桌面渲染 | AgentLoop、Session JSONL |
| `runtime-host` | worker/frontend 生命周期、IPC、路由 | Session 事实、工具决策、UI 渲染 |
| `agent-worker` | AgentLoop、SessionStore、单 Session writer | UI 渲染、frontend 生命周期 |

条件编译只处理 OS 和底层 backend 差异，例如 PTY、Slint backend、OS sandbox；不用于在一个 crate 中选择 CLI 或 Desktop 产品。

## 3. 宿主事件合约

### 3.1 模型响应状态

`ModelResponseSnapshot` 由 `ModelResponseBuilder` 从模型 stream 折叠得到，表示一次 LLM call 在某个时刻的完整响应状态：

```text
content + pending + stop_reason + usage + model
```

它不携带 `turn`、`step`、`llm_call_id` 或 retry identity；这些属于 Loop 编排上下文。

### 3.2 Agent 宿主事件

候选的 `agent::ProgressEvent`：

```rust
AssistantResponseSnapshot {
    turn: u64,
    step: u32,
    llm_call_id: String,
    update_index: u32,
    snapshot: ModelResponseSnapshot,
}

AssistantFinalized {
    turn: u64,
    blocks: Vec<ContentBlock>,
}
```

语义：

- 每个 `TurnEvent::MessageUpdate` 都产生一个 `AssistantResponseSnapshot`；
- 同一个 `llm_call_id` 内，snapshot 是完整替换状态，不是 delta；
- `update_index` 标识同一次 LLM call 内的顺序；
- `AssistantFinalized` 是 assistant 内容进入 transcript / Session Item Log 的确认边界；
- snapshot 是临时 UI 状态，不写入 Session Item Log；
- `ToolCall` / `ToolResult` 独立表达工具生命周期，不塞入 assistant snapshot。

### 3.3 CLI / Desktop 渲染规则

前端自行维护 `RenderState`：

```text
LlmCallStarted
  → 创建当前 call 草稿

AssistantResponseSnapshot
  → 替换当前 call 草稿

AssistantFinalized
  → 提交当前 call 的正式 assistant 文本

下一个 llm_call_id
  → 保留已确认文本，开始新草稿
```

`Agent::turn()` 返回的 `ModelResponse` 是最终成功结果；流式路径已输出相同文本时，frontend 做 dedup，否则作为 fallback 补写。错误和取消通过 `Result` / Turn outcome 表达，不伪造带 error 状态的 `ModelResponse`。

## 4. 当前阶段：进程内宿主

当前先保持：

```text
cli-frontend → agent → agent-core
desktop-frontend → agent → agent-core
```

`AgentConfig` 继续使用单个 `ProgressObserver` 接缝；CLI 组合 stream、tool panel、trace 和 thinking observer，并由 REPL 生命周期持有、在 reload/switch 时复用同一个实例。

当前阶段不实现：

- scheduler / supervisor 子进程；
- Agent Worker；
- IPC 和跨进程 event bus；
- 常驻 daemon；
- server/headless frontend；
- 多 Session 并发。

## 5. 后续阶段：Runtime Host

出现明确的长生命周期或故障隔离需求后，再演进为：

```text
launcher
  → runtime-host / supervisor
      ├─ agent-worker
      └─ cli-frontend / desktop-frontend
```

建议一个活跃 Session 对应一个 worker：

- worker 独占 AgentLoop 和 SessionStore；
- 一个 Session 同时只有一个 writer；
- Runtime Host 不持有 SessionStore，不解析 Session JSONL；
- frontend 通过 Runtime Host 订阅语义事件；
- worker 崩溃后不得盲目重放可能已经产生副作用的 ToolCall；
- 恢复必须以 Session Item Log 的可 materialize 状态和明确的未知结果语义为前提。

跨进程后再引入轻量的 `runtime-protocol`，承载：

```text
FrontendCommand
WorkerCommand
RuntimeEvent
event_seq / session_id / turn / step / llm_call_id
protocol_version
```

Runtime Host 只负责生命周期、路由、取消、订阅和退出状态；它不决定 permission、tool retry 或 assistant 如何展示。

## 6. 演进批次

### P0：合约与文档

- 固化 snapshot / finalized / outcome 语义；
- 补宿主事件和 session query 的验收清单；
- 更新 CLI、Desktop 方向和任务文档；
- 不修改多进程运行时。

### P1：进程内 CLI 宿主能力

- `SessionStore::list_summaries(&Path)`；
- `Agent::list_sessions(&Path)`；
- `Agent::switch_session` 正确更新 session identity；
- `AssistantResponseSnapshot` / `AssistantFinalized`；
- composite observer 和稳定 renderer 生命周期；
- retry、tool round、错误、取消和 final dedup 测试；
- settings persistence、quiet startup、`/session`。

### P2：独立 Desktop 产物

- 新增 Desktop Cargo package；
- Desktop 复用 `agent` 宿主 API；
- Desktop 自己维护 UI RenderState；
- 先采用进程内调用，不引入 IPC。

### P3：Runtime Host 多进程

只有以下需求真实出现时启动：

- Turn 需要脱离 frontend 持续运行；
- CLI/Desktop attach 到同一个活跃 Session；
- worker crash recovery 成为验收要求；
- 多 Session 并发或后台队列出现；
- 工具执行需要独立的 OS sandbox 边界。

### P4：ServerFrontend

Server/headless 作为独立子进程接入 Runtime Host；不进入当前 CLI R5 和 Desktop v0.1。

## 7. 验收原则

进程内阶段至少验证：

- snapshot 在同一 `llm_call_id` 内替换，不重复；
- retry 不把失败 partial snapshot 提交到 transcript；
- tool round 前后的 assistant 文本不丢失；
- `AssistantFinalized` 与 Session Item Log 提交边界一致；
- provider/tool error 和 Ctrl-C 后 REPL 可继续；
- CLI/Desktop 不直接访问 agent-core 内部 Session 文件；
- `just check` 通过，并完成真实 PTY/终端 smoke test。

多进程阶段另行增加：

- worker/frontend handshake；
- event sequence 和断线行为；
- cancellation → await cleanup；
- worker crash、未知副作用和恢复；
- single-writer lease；
- frontend 退出时 worker 的收尾策略。

## 8. 未决问题

以下问题留到真正启动 P3 时解决：

1. Runtime Host 是每次启动的前台 supervisor，还是跨启动常驻 daemon；
2. `runtime-host` 是否与未来资源调度器拆成两个进程；
3. IPC 使用 Unix socket、stdio 管道还是跨平台本地 transport；
4. worker crash 后 Session 的恢复和人工介入界面；
5. 独立工具 sandbox 与 worker 权限边界。
