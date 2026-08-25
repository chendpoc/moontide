# agent progress host events — 技术设计

> **读者：** `agent` 实现者、CLI/Desktop 宿主和代码审查者。
> **对外契约：** [`README.md`](README.md)。

## 1. 职责与边界

`progress` 是 `agent` 组合根里的只读派生层：它消费 `TurnEvent`，将核心事实和流式观测转换为宿主可用的 `ProgressEvent`。

| 做 | 不做 |
|---|---|
| 传播 assistant 全量 snapshot | 渲染 stdout、终端或 Desktop frontend |
| 添加 turn/step/call/update identity | 修改 AgentLoop 决策 |
| 在 commit 后传播 finalized | 写 Session 或 Agent Event |
| 传播完整 ToolCall / ToolResult payload | 暴露完整 provider wire event |
| 保持 observer fail-open、入队不阻塞 | 把 observer 错误传回 Loop |

依赖方向：

```text
agent-core::TurnEvent
        ↓
agent::progress
        ↓
CLI / Desktop / headless frontend
```

`agent-core` 不依赖 `agent`；`progress` 不依赖任何 frontend crate。

## 2. 公开类型

`ProgressObserver` 保持现有签名：

```rust
pub trait ProgressObserver: Send + Sync {
    fn on_progress(&self, event: &ProgressEvent) -> anyhow::Result<()>;
}
```

`ProgressEvent` 的完整公开形状如下；ToolCall / ToolResult 使用 canonical typed payload，展示摘要由 CLI/Desktop formatter 负责：

```rust
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

`ProgressEvent` 使用 `PartialEq` 进行测试，不承诺 `Eq`：`ModelResponseSnapshot` 的 content 可能包含不具备 `Eq` 语义的 JSON 值。

## 3. 派生算法

### 3.1 snapshot

`TurnEvent::MessageUpdate` 已携带完整 `ModelResponseSnapshot`。`ProgressHook` 维护当前活跃 LLM call 的短生命周期计数器；R2 不再派生独立 `Thinking` event：

```text
LlmCallStarted(call-A)
  → update(snapshot-A, index=0)
  → update(snapshot-A, index=1)
  → LlmCallEnded(call-A)
  → AssistantFinalized(call-A)
```

规则：

1. `LlmCallStarted` 建立当前 `(turn, step, llm_call_id)`，计数器置为 `0`，并把 call identity 直接传播给宿主；
2. 每个 `MessageUpdate` 先复制当前 index，再递增计数器并发送完整 snapshot；
3. 每个 attempt 恰好产生一个 `LlmCallEnded`，成功、请求失败、无效响应和取消都通过 `LlmCallOutcome` 表达；
4. 新的 `LlmCallStarted` 覆盖旧 identity，retry 使用新的 `llm_call_id`，但保持相同 `step`；
5. 不跨 turn 复用 identity；
6. 若观察到违反核心事件顺序的 `MessageUpdate` 或 `AssistantFinalized`，只产生受控诊断并跳过该派生事件，不 panic。

R2 的 Loop 是单实例、单活跃 turn，因此不需要为多个并发 call 建立全局 map；计数器属于一个 `ProgressHook` 生命周期，避免无界 identity 累积。

### 3.2 finalized

`TurnEvent::AssistantFinalized` 的非空 blocks 变体是 committable event；空 blocks marker 只用于关闭 tool-only call 的运行时 draft，不产生 Session item。对非空 blocks，`EventDispatcher` 会先完成 Session commit，再调用 post-commit hook，因此 `ProgressHook` 看到它时，blocks 已是确认事实。

核心 `TurnEvent::AssistantFinalized` 显式携带产生该 blocks 的 `llm_call_id`。`ProgressHook` 直接转发这个 identity，不再通过事件邻接关系推断 call identity。非空 blocks 通过 Session commit；tool-only response 发送空 marker，但不写入 Session Item Log。该字段只用于运行时事件关联，不改变 Session Item Log schema。

如果未来需要让一个 finalized event 独立表达 step，也必须先修改 core event 的公开契约，不能由宿主根据事件邻接关系推断。

## 4. 事件序列和 frontend fold

典型 terminal turn：

```text
TurnStarted
  → UserPromptCommitted        # 非 ProgressEvent，仅 core commit
  → LlmCallStarted
  → AssistantResponseSnapshot*
  → LlmCallEnded
  → AssistantFinalized
  → TurnEnded
```

典型 tool turn：

```text
LlmCallStarted
  → AssistantResponseSnapshot*
  → LlmCallEnded
  → AssistantFinalized         # 每个成功 call 一次；tool-only 可为空 marker
  → ToolCall
  → ToolResult
  → LlmCallStarted             # next step
```

宿主的最小 fold：

```text
AssistantResponseSnapshot → drafts[(turn, llm_call_id)] = snapshot
AssistantFinalized        → append non-empty committed blocks; remove and tombstone matching draft
Agent::turn(Err)           → mark/discard unfinalized drafts according to UI policy
```

`ProgressEvent` 只提供事实和 identity；是否节流、是否显示 thinking、如何把 blocks 转成文本都由宿主决定。

## 5. 失败和 fail-open

- snapshot observer 返回错误时，worker 记录诊断并继续消费；后续 snapshot/finalized 仍可继续派生；
- `Agent::turn` 的 provider、tool 或 cancellation 错误通过 `Result` 返回，不包装成成功型 `ModelResponse`；
- 失败 attempt 的 partial snapshot 可以已被观察到，但不会产生成功型 `AssistantFinalized`；该 attempt 仍产生 `LlmCallEnded(Failed/Cancelled)`；retry 的新 call 使用新的 identity；
- `AssistantFinalized` observer 失败不撤销已经完成的 Session commit；frontend 应以 Session/turn 返回值恢复；
- snapshot 不进入持久化日志，进程崩溃后不能从 snapshot 恢复。

### 5.1 ProgressWorker non-blocking

`EventDispatcher` 仍是同步的 commit → post-commit Hook 入口，但 `ProgressHook` 不直接调用 observer：

```text
AgentLoop
  → EventDispatcher::emit(TurnEvent)
      → commit committable fact
      → ProgressHook.try_send(ProgressEvent)
      → return to AgentLoop

ProgressWorker
  → bounded queue
  → serialized ProgressObserver calls
```

约束：

- `ProgressHook` 只做有界 clone、identity 校验和非阻塞 `try_send`；不 `await` observer；
- snapshot 允许按 `(turn, llm_call_id)` coalesce，生命周期事件不 coalesce；
- ToolCall、ToolResult、LlmCallEnded、AssistantFinalized 和 TurnEnded 保持语义顺序；
- 队列溢出不能阻塞 AgentLoop，记录 `resync_required`，frontend 从 canonical Session / Agent 结果恢复；
- worker 状态至少暴露 `Running` / `Degraded` / `Stopped`、队列容量/长度、`dropped_events`、最近错误和 `resync_required`；
- observer 错误只在 worker 中诊断，不回传 Loop；需要 one-shot 退出前保证输出时，由宿主显式 flush；
- `ProgressWorker` 的 `start` / `spawn` 只能在 Tokio runtime 内创建，不提供同步直调 observer 的 fallback；`Agent::create`、`resume`、`reload` 也要求 Tokio runtime；
- before-event 决策不通过 Hook 实现；permission、approval、cancel、retry 使用显式 API，普通 plugin 只使用 post-commit observer。

## 6. 实现文件和测试方向

```text
crates/agent/src/progress.rs       # ProgressEvent、ProgressHook、派生状态
crates/agent/src/progress/README.md
crates/agent/src/progress/DESIGN.md
crates/agent/src/progress/TASKS.md
crates/agent/src/tests.rs           # 宿主接缝集成测试
```

测试覆盖：

- 同一 call 的 snapshot index 从 0 单调递增；
- retry 使用新 `llm_call_id` 且 index 重新开始；
- finalized 携带核心事件提供的 call identity；tool-only marker 不写入 Session；
- ToolCall / ToolResult 完整 typed payload 不丢失；
- tool round 中 assistant finalized、tool call/result 顺序保持不变；
- 每个 attempt 都有一个 LlmCallEnded outcome；
- partial snapshot 后的失败不产生成功型 finalized；
- snapshot coalesce、队列溢出和 frontend resync 不阻塞 AgentLoop；
- observer 错误不改变 Agent turn 结果和 Session commit；
- bounded tool input/result 约束继续成立；`dropped_bytes` 和 byte-budget queue 仍后置；Agent Event Log worker 位于独立的 `agent::log` lane。

## 7. 实现分期

R2 只实现上述 host projection 和 agent 内部 ProgressWorker。Desktop crate 的具体 Iced 窗口、IPC、事件回放和多 session 并发属于后续消费者，不在本批扩展。
