# agent progress host events

> **性质：** `agent` 对 CLI、Desktop 等宿主暴露的只读事件契约。
> **实现细节：** [`DESIGN.md`](DESIGN.md)。

## 1. 这是什么

`agent::progress` 将 `agent-core::TurnEvent` 转换为宿主可消费的语义事件。它不负责终端、Slint 或其他 UI 的布局和渲染；宿主收到事件后自行维护 `RenderState`。

```text
LLM stream
  → ModelResponseBuilder
  → TurnEvent::MessageUpdate
  → agent::ProgressEvent::AssistantResponseSnapshot
  → CLI / Desktop RenderState

AssistantFinalized
  → 已提交的 assistant 事实
  → 宿主确认并清理对应 draft
```

snapshot 是同一个 LLM call 的临时全量替换状态，不是增量文本。前端按 `llm_call_id` 替换旧 snapshot，因此可以得到连续的实时渲染，而不会把 `Hel`、`Hello` 等中间值当成多条 assistant 消息。ToolCall 和 ToolResult 也完整传播；是否显示、显示摘要还是显示完整 payload 由 frontend 决定。

## 2. 公开 API

```rust
pub trait ProgressObserver: Send + Sync {
    fn on_progress(&self, event: &ProgressEvent) -> anyhow::Result<()>;
}

pub enum ProgressWorkerState {
    Running,
    Degraded,
    Stopped,
}

pub struct ProgressStatus {
    pub state: ProgressWorkerState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub resync_required: bool,
    pub last_error: Option<String>,
}

impl ProgressHandle {
    pub async fn flush(&self) -> anyhow::Result<()>;
    pub fn status(&self) -> ProgressStatus;
}

pub enum ProgressEvent {
    TurnStarted { turn: u64 },
    LlmCallStarted {
        turn: u64,
        step: u32,
        llm_call_id: String,
    },
    AssistantResponseSnapshot {
        turn: u64,
        step: u32,
        llm_call_id: String,
        update_index: u32,
        snapshot: ModelResponseSnapshot,
    },
    ToolCall {
        turn: u64,
        call: ToolCall,
    },
    ToolResult {
        turn: u64,
        result: ToolResult,
    },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        outcome: LlmCallOutcome,
    },
    AssistantFinalized {
        turn: u64,
        llm_call_id: String,
        blocks: Vec<ContentBlock>,
    },
    TurnEnded { turn: u64 },
}
```

字段规则：

- `AssistantResponseSnapshot` 的 `snapshot` 是 `ModelResponseBuilder` 在该时点的完整状态；`pending` 可以存在，表示尚未完成的 text、thinking 或 tool use block。R2 不再提供独立 `Thinking` event，frontend 从 snapshot 自己渲染 thinking。
- `update_index` 从 `0` 开始，在一个 `llm_call_id` 内严格递增；新 call 重新从 `0` 开始。
- 宿主以 `(turn, llm_call_id)` 作为 draft identity；`update_index` 用于丢弃迟到或重复的 snapshot。
- `LlmCallEnded` 对每个 attempt 恰好发送一次；`outcome` 使用核心 enum，不使用状态字符串。
- `ToolCall` / `ToolResult` 携带完整 canonical payload；progress 不提前转换成摘要字符串。
- `AssistantFinalized` 表示该成功 call 的 assistant response 已结束；非空 blocks 通过 Session commit，tool-only 的空 marker 不写入 Session。
- `AssistantFinalized` 只使用核心事件提供的 `turn` / `llm_call_id`，不从上一条事件推断 step。
- `Agent::turn` 返回的 `ModelResponse` 是最终调用结果；宿主可以用它做完成态校验。

## 3. 错误和所有权

- `ProgressEvent` 不写 Session Item Log，不写 Agent Event Log，也不包含 UI 状态；完整事实由核心 Session / Agent Event 链路记录。
- observer 失败只作为诊断记录，不能让 Loop、permission、retry 或 cancellation 失败；`Agent::turn` 的 `Result` 才是执行成功/失败的权威结果。
- provider/tool/turn 失败不会伪造成功型 `ModelResponse` 或 `AssistantFinalized`。失败 attempt 仍有 `LlmCallEnded(outcome)`；宿主从 `Agent::turn` 的错误结果结束或标记当前 draft。
- CLI、Desktop 和未来 headless frontend 可以共享事件契约，但各自决定节流、布局、文本合并和错误展示。

## 4. 不属于本批

- 不直接依赖 Slint、crossterm 或具体 frontend；
- 不新增跨进程 IPC、Runtime Host 或 scheduler；ProgressWorker 仅是 agent 内部的异步 observer consumer；
- 不把 provider 的 `ModelStreamEvent` 暴露给宿主；
- 不把 snapshot 写入 Session，也不把它当作可恢复事实。

ProgressHook 只负责把完整 `ProgressEvent` 以 `try_send` 放入独立的有界
ProgressQueue，随后立即返回；ProgressWorker 在独立消费链路中串行调用
`ProgressObserver`。snapshot 可以按 `(turn, llm_call_id)` coalesce 为最新值，
ToolCall、ToolResult、LlmCallEnded 和 finalized 等生命周期事件保持顺序。
队列溢出不阻塞 AgentLoop，worker 进入 `Degraded` 并暴露
`dropped_events` / `resync_required`，frontend 通过 resync 从 canonical Session /
Agent 结果恢复。R2 不要求 `dropped_bytes` 或 byte-budget queue。

ProgressQueue 不与 Agent Event Log queue 共享；后者由 [`agent::log`](../log/README.md)
负责诊断落盘。两类 worker 都必须在 Tokio runtime 内创建和启动，不提供无 runtime
的同步 observer 或文件写入 fallback。`Agent::create`、`Agent::resume` 和
`Agent::reload` 也要求调用方已经运行在 Tokio runtime 内。

更多 fold、序列和实现约束见 [`DESIGN.md`](DESIGN.md)。
