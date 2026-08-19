# agent log — 技术设计

> **读者：** `agent` 实现者、组合根维护者和代码审查者。
> **对外契约：** [`README.md`](README.md)。

## 1. 职责与边界

| 做 | 不做 |
|---|---|
| Agent Event Record 的 bounded queue | Session Item Log 写入 |
| Agent Event Log worker 生命周期 | Progress frontend rendering |
| 按 policy 装配或关闭 diagnostic sink | permission、approval、retry、cancel 决策 |
| 文件 writer 独占与显式 flush | 从 Agent Event Log 恢复 Session |
| dropped event / worker status | 领域 Run 实体 |

`agent-core::event` 负责 `TurnEvent → AgentEventRecord` 和 `AgentEventRecorder` port；本模块负责异步消费和持久化装配。

## 2. 模块结构

```text
crates/agent/src/log/
  README.md
  DESIGN.md
  mod.rs
  policy.rs                 # PersistenceConfig 的 diagnostic 接缝
  queued_recorder.rs        # bounded try_send + status
  worker.rs                 # AgentEventLogWorker
  file_recorder.rs          # JSONL、seq/turn、truncate、flush
```

`ProgressWorker` 不放进本模块；Progress 是实时宿主事件，不是诊断日志。

## 3. 类型与签名

```rust
pub enum AgentEventLogState {
    Running,
    Degraded,
    Stopped,
}

pub struct AgentEventLogStatus {
    pub state: AgentEventLogState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub last_error: Option<String>,
}

pub struct AgentEventLogHandle {
    // private sender and shared status
}

impl AgentEventLogHandle {
    pub async fn flush(&self) -> anyhow::Result<()>;
    pub fn status(&self) -> AgentEventLogStatus;
}
```

内部接缝：

```rust
pub(crate) struct QueuedAgentEventRecorder { /* bounded sender */ }

impl agent_core::event::AgentEventRecorder for QueuedAgentEventRecorder {
    fn append(&self, record: AgentEventRecord) -> anyhow::Result<()>;
}

pub(crate) struct AgentEventLogWorker { /* receiver + file recorder */ }

impl AgentEventLogWorker {
    pub(crate) fn start(
        receiver: tokio::sync::mpsc::Receiver<AgentEventRecord>,
        recorder: FileAgentEventRecorder,
    ) -> anyhow::Result<AgentEventLogHandle>;
}
```

`start` 要求当前存在 Tokio runtime；无 runtime 直接返回错误。`Agent::create`、`resume`、`reload` 同样要求运行在 Tokio runtime 内，即使当前 policy 关闭 diagnostic worker。

## 4. 数据流和持久化边界

```text
EventDispatcher
  → DeriveAgentEventHook
      → derive_agent_event
          → full AgentEventRecord
              → QueuedAgentEventRecorder.try_send
                  → AgentEventLogWorker
                      → FileAgentEventRecorder
                          → JSONL persistence
```

规则：

1. Hook 不执行文件 IO；
2. queue 保存完整 canonical payload；
3. queue 满时立即丢弃，不等待；该丢失只递增 `dropped_events` 并返回成功，不向 Agent turn 传播 backpressure；
4. worker 串行消费，保证 Agent Event Log 内部顺序；
5. 文件 recorder 在落盘阶段处理 JSONL 大小限制、preview、truncate 和 `originalBytes`；
6. `ToolResult::content` 在 derive 和 queue 阶段不降级为 body string；
7. 文件 flush 失败只影响诊断 worker，不回滚已经成功 commit 的 Session fact。

## 5. Persistence policy

`PersistenceConfig` 由 CLI/frontend 解析并通过 `AgentConfig` 传入。`agent-core` 不读取 settings.json。

| policy | bootstrap 行为 |
|---|---|
| `DiagnosticPersistence::Off` | 不注册 Agent Event Hook，不创建 worker，不创建 runs 文件 |
| `Errors` | 后置；错误事件分类需要单独定义 |
| `Normal` | 注册 worker，记录选定语义事件 |
| `Debug` | 注册 worker，允许全量 snapshot / raw trace（需脱敏和 retention） |

`SessionPersistence::Disabled` 在 R2 只保留枚举位置，不实现；它需要 memory-only SessionStore 或可插拔 Session backend。

## 6. 状态与错误

R2 只维护：

- `Running` / `Degraded` / `Stopped`；
- queue capacity / length；
- `dropped_events`；
- `last_error`。

不实现 `dropped_bytes`、byte-budget queue 或 metrics exporter。若未来按字节限制 queue，再新增对应计量字段。

worker 的 observer / file error 记录诊断并进入 `Degraded` 或 `Stopped`；不得通过 Hook 返回到 AgentLoop，也不得伪造 Session commit 成功或失败。

## 7. Import 边界

```text
agent::log → agent-core::event::{AgentEventRecord, AgentEventRecorder}
agent::bootstrap → agent::log
agent::log ↛ agent-core::session
agent::log ↛ agent-core::loop
agent::log ↛ cli
```

`FileAgentEventRecorder` 的物理文件实现从 event core 迁移到本模块；event core 只保留 port 和 derive contract。

## 8. 单测方向

- `DiagnosticPersistence::Off` 不注册 hook、不创建 worker、不创建 runs 文件；
- queued recorder 满时立即返回且累计 `dropped_events`；
- worker 按入队顺序写入完整 AgentEventRecord；
- ToolCall / ToolResult canonical payload 在落盘前不被 derive 降级；
- 文件落盘阶段的 64 KiB 限制、truncate、seq/turn 恢复继续成立；
- flush 等待已入队记录完成；
- worker error 不影响 Session commit 和 Agent turn 结果；
- Agent create/resume/reload 在无 Tokio runtime 时返回明确错误。
