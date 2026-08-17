# event

> **对外使用说明** — 集成 `agent-core::event` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)
> **状态：** R1 commit-only 已实现；观测、hook、bus 后置。
> **关联：** [`../session/README.md`](../session/README.md) · [`crates/docs/agent-core.md`](../../../docs/agent-core.md)

---

## 这是什么

`event` 是 loop 向 Session Item Log 提交 Turn 事实的同步边界。

```text
loop.emit(TurnEvent)
    → EventDispatcher
        → CommitHandler
            → session.append
```

`loop` 不直接持有 `SessionStore`，`session` 仍是 Session Item Log 唯一写者。

---

## 当前契约

```rust
pub enum TurnEvent {
    UserPromptCommitted { turn: u64, text: String },
    AssistantFinalized { turn: u64, blocks: Vec<ContentBlock> },
    ToolCallRecorded { turn: u64, call: ToolCall },
    ToolResultRecorded { turn: u64, result: ToolResult },
    CompactionApplied { /* persisted compaction fact */ },
}

pub trait CommitHandler: Send + Sync {
    fn commit(&self, event: &TurnEvent) -> anyhow::Result<()>;
}

impl EventDispatcher {
    pub fn new(commit: Arc<dyn CommitHandler>) -> Self;
    pub fn emit(&self, event: TurnEvent) -> anyhow::Result<()>;
}
```

所有当前 `TurnEvent` 都是必须同步写入 Session Item Log 的事实。不存在 observational-only 变体或 `is_committable` 分支。

---

## 谁该用什么

| 调用者 | 使用 | 禁止 |
|---|---|---|
| `loop` | `EventDispatcher::emit` | 直接访问 `SessionStore` |
| `agent` | 用 `SessionCommitHandler` 装配 dispatcher | 注入观测或权限策略 |
| `session` | 实现 `CommitHandler` | 反向依赖 loop |

---

## 典型装配

```rust
let store = SessionStore::create(&sessions_dir, cwd)?;
let dispatcher = EventDispatcher::new(Arc::new(SessionCommitHandler::new(store)));

dispatcher.emit(TurnEvent::UserPromptCommitted {
    turn,
    text,
})?;
```

`emit` 成功返回时，对应 SessionItem 已完成提交；失败则原始错误传播到 Turn 边界。

---

## 当前非目标

- Agent Event Log、JSONL trace、retention 与 replay
- OTel trace/span、实时调用树和 exporter
- ObserveHandler、EventBus、sidecar bridge
- HookHandler 或通过 event 隐式执行 permission
- UI 流式事件协议

这些能力在出现真实接入方时重新走架构对齐，不预留 `TraceContext`、`EventContext`、`ObservationScope` 或 `trace_id`。

实现不变量与测试方向见 [`DESIGN.md`](DESIGN.md)。
