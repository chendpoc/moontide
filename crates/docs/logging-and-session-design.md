# 日志与 Session 设计（候选设计）

> 状态：候选设计（notes），未实现。收敛「三流分离 + session log + logger」的完整方案。

## 总览：文件布局 + 三条流

```
~/.moontide/
├── sessions/
│   ├── {session_id}.meta.json       # header（外置元数据，随机读）
│   └── {session_id}.log.jsonl        # session log（agent event，append-only，可重放）
├── runtime/                          # sidecar runtime 共享缓存（见 TODO 21）
│   └── bun/1.1.x/bun
└── logs/
    └── moontide.log                  # 程序运行时诊断（可丢弃）
```

三条流物理分离，职责不重叠：

| 流 | 内容 | 落点 | 可否丢弃 | 判断标准 |
|---|---|---|---|---|
| **session log** | agent event（数据 + 生命周期事实） | `.log.jsonl` | 否，可重放 | 「模型可见 / resume 后要知道」 |
| **logger** | 程序运行时诊断 | stderr + `.logs/` | 是 | 「只排查用」 |
| **stdout** | 数据输出（`--emit jsonl`） | stdout | 是 | 给外部程序消费 |

## session log 层

```rust
struct EventEnvelope { seq: u64, time: SystemTime, event: SessionEvent }

enum SessionEvent {
    // 生命周期（事实，必须持久化）
    SessionStart { source: SessionStartSource },   // startup | resume | fork
    TurnStart   { turn: u64 },
    TurnEnd     { turn: u64, reason: TurnEndReason }, // completed | aborted | error
    // step 范围
    StepStart { turn: u64, step: u64 },
    StepEnd   { turn: u64, step: u64 },
    // 数据（模型可见，必须可重放）
    UserMessage      { message: UserMessage },
    AssistantChunk   { turn: u64, step: u64, chunk: StreamChunk },
    AssistantMessage { turn: u64, step: u64, message: AssistantMessage },
    ToolCall         { turn: u64, step: u64, call: ToolCall },
    ToolResult       { turn: u64, step: u64, result: ToolResult },
    SteeringMessage  { message: UserMessage },
}

struct SessionHeader {  // .meta.json，外置
    version: u32, session_id: SessionId, cwd: PathBuf,
    parent_session: Option<SessionId>, seed_len: u64,
}
```

**四个不变量**（贯穿 append 和 resume）：

1. `seq == log.len()` 连续性，断号即报错。
2. 先校验（可无损序列化）再入队，入队后冻结。
3. 模型可见内容先 append 再发请求（`UserMessage` 在 `derive` 之前）。
4. header 不进 log（元数据不是可重放事件）。

**投影 + 恢复**：

```rust
fn derive_messages(&self) -> Vec<Message>;          // 请求前从 log 投影模型历史
fn resume(session_id) -> Result<Agent>;             // 读 header → 逐条重放校验 → 投影 → 恢复游标/inbox
fn fork(source, boundary) -> Result<SessionId>;     // 只在 turn 边界切，拒绝半截
```

## logger 层

```rust
tracing_subscriber::fmt()
    .with_env_filter(EnvFilter::from_default_env())  // MOONTIDE_LOG=debug
    .with_writer(stderr)                              // 铁律：只写 stderr，绝不 stdout
    .init();
```

span 分层（turn/step/session 挂进日志上下文，grep 可串起来）：

```rust
#[tracing::instrument(skip_all, fields(session_id = %self.id, turn, step))]
async fn step(&mut self, turn: u64, step: u64) -> Result<()> {
    tracing::debug!("deriving history");
    tracing::info!("model request", provider = %provider);
    tracing::error!("model request failed", err = %e, retry = 2);
}
```

级别：`error`（真实故障）→ `warn`（降级/可恢复）→ `info`（里程碑）→ `debug`（排查）→ `trace`（极致）。

## 双写原则（关键）

生命周期事实双写，但两边内容不同：

| 事件 | session log 记（事实，可重放） | logger 记（诊断，可丢弃） |
|---|---|---|
| agent create | `SessionStart{source:startup}` + header | `info: "agent created"` + 耗时 |
| 用户 cancel | `TurnEnd{reason:aborted}` | `info: "cancelled by user"` |
| 模型请求失败 | `TurnEnd{reason:error}` | `error: "request failed"` + 上下文 |

规律：**session log 记「发生了什么」（结构化、可重放），logger 记「怎么发生的」（过程、耗时、stack）**。

判断流程：

```
这个事实：
  1. 模型「看到」了吗？         → 是：session log（event）
  2. resume 后要「知道」吗？    → 是：session log（event / header）
  3. 都不是，只排查要「看」？   → logger（stderr / 文件）
```

## 配置项

```toml
[logging]
level = "info"                            # error|warn|info|debug|trace
file = "~/.moontide/logs/moontide.log"    # 可选，持久化诊断
json = false                              # true 时 logger 输出 JSON

[session]
dir = "~/.moontide/sessions"
```
