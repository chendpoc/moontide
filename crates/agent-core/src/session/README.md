# session

> **对外使用说明** — 集成 `agent-core::session` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)。
> **状态：** R1–R3、v2 tool payload 与 Loop R1 `next_turn` / direct mutable commit seam 已实现。
> **关联：** [`../loop/README.md`](../loop/README.md) · [`../event/README.md`](../event/README.md) · [`crates/docs/agent-core.md`](../../../docs/agent-core.md)

---

## 这是什么

`session` 维护整场对话的 **Session Item Log**（append-only 事实源）：

```text
.moontide/sessions/
└── {YYYY-MM-DD}/                  # 本地日期分区
    ├── {session_id}.meta.json     # SessionHeader
    └── {session_id}.log.jsonl     # 每行一条 SessionItem
```

**一句话：** session 负责事实的 create/load/append/fork 和只读查询；不负责模型输入 shaping（`context`）、Turn 状态机（`loop`）或观测日志（`event`）。

---

## 设计原理（brief）

```text
agent: create | load | fork
          │ 一次性转移所有权
          ▼
       AgentLoop
          │
          ├─ items() ──► context::materialize
          │
          └─ event.emit(&mut SessionStore, TurnEvent)
                         │
                         ▼
                    commit_item
                         │
                         ▼
                  Session Item Log
```

- **唯一写盘：** `SessionStore::commit_item`；生产路径由 SessionStore 的 `CommitHandler` 实现调用；
- **单一 runtime owner：** AgentLoop 独占持有 non-Clone SessionStore；
- **resume：** `load` → `items()` → `context::materialize`；
- **tool：** ToolCall / ToolResult 分行存储并直接包装 tools 契约；
- **不进 log：** TurnStarted/Ended、LLM attempts、流式 update、trace。

R1 不使用 `Arc<Mutex<SessionStore>>`，也不实现 OS 文件 lease。同一 session 被两个独立 AgentLoop 同时 load 并写入是不支持用法，不是当前要解决的并发 case。

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`agent`** | `create` / `load` / `fork`，随后移入 `AgentLoopInit` | 构造 AgentLoop 后保留第二个 writer |
| **`loop`** | `items()`、crate-private `next_turn()`，把 store 借给 event commit | 直接 `commit_item`、Clone store |
| **`context`** | `items()` 只读 slice | append / fork |
| **`event`** | 通过 `CommitHandler` 调用 SessionStore 的 mapping | 长期拥有 store、加 Mutex |
| **`cli`** | 通过 agent create/load/fork | 生产路径直接 append |
| **测试** | 全部低层 API | 用多 writer 测试宣称跨实例安全 |

---

## 公开 API

```rust
impl SessionStore {
    pub fn latest_session_id(
        sessions_dir: impl AsRef<Path>,
    ) -> anyhow::Result<Option<String>>;

    pub fn create(
        sessions_dir: impl AsRef<Path>,
        cwd: PathBuf,
    ) -> anyhow::Result<Self>;

    pub fn load(
        sessions_dir: impl AsRef<Path>,
        session_id: &str,
    ) -> anyhow::Result<Self>;

    pub fn commit_item(
        &mut self,
        draft: SessionItemDraft,
    ) -> anyhow::Result<&SessionItem>;

    pub fn fork(
        &self,
        sessions_dir: impl AsRef<Path>,
        boundary_item_id: &str,
    ) -> anyhow::Result<Self>;

    pub fn items(&self) -> &[SessionItem];
    pub fn header(&self) -> &SessionHeader;

    pub(crate) fn next_turn(&self) -> anyhow::Result<u64>; // Loop R1
}

impl event::CommitHandler for SessionStore {
    fn commit(
        &mut self,
        event: &TurnEvent,
    ) -> anyhow::Result<Option<String>>;
}

pub struct SessionSummary {
    pub session_id: String,
    pub cwd: PathBuf,
    pub last_turn: Option<u64>,
    pub item_count: usize,
}

pub struct SessionSnapshot {
    pub summary: SessionSummary,
    pub items: Vec<SessionItem>,
}

pub struct SessionQuery;

impl SessionQuery {
    pub fn new(sessions_dir: PathBuf) -> Self;
    pub fn list(&self) -> anyhow::Result<Vec<SessionSummary>>;
    pub fn load(&self, session_id: &str) -> anyhow::Result<SessionSnapshot>;
}
```

`SessionQuery` 只读打开和校验已有 log，不创建 writer、不追加文件；`list` 按
`session_id` 确定性排序。

`latest_session_id()` is a read-only lookup over persisted date partitions. It returns `None`
when the sessions directory does not exist and never creates a session or modifies the log.

`next_turn()` 是只读 cursor 计算：empty → 0；最后一条 item 的 turn 为 N → checked `N + 1`。它不预占编号；`UserPromptCommitted` 成功 append 后，该编号才不可复用。

当前 `commit_from_event(&mut SessionStore, &TurnEvent)` 作为内部 mapping 保留。现有 `SessionCommitHandler` / Mutex wrapper 在 Loop 接缝批移除，由 SessionStore 直接实现 mutable `CommitHandler`。

**Draft 规则：** 调用方只提供 `turn` + payload；`id` / `seq` / `session_id` / `at` 由 store 分配。

条目：`UserMessage` · `AssistantMessage` · `ToolCall` · `ToolResult` · `Compaction` · `CheckpointCreated`。

当前 schema v2：ToolCall/ToolResult flatten canonical tools 类型，完整保留 typed status；`ToolContent` 用 `{ type, value }` 显式 tag。读取 v1 时接受旧 kind，缺失 status 保守映射 `OutcomeUnknown`，历史 string content → Text，其他 JSON → Json；未知 header version 拒绝。

---

## 典型用法

### 组合根创建并转移所有权

```rust
let session = SessionStore::create(&sessions_dir, cwd)?;

let agent_loop = AgentLoop::new(AgentLoopInit {
    session,
    provider,
    tools,
    events,
});
```

### Resume

```rust
let session = SessionStore::load(&sessions_dir, &session_id)?;
context::materialize(session.items())?; // AgentLoop 每 Turn 的 preflight
```

### 生产 append

```text
AgentLoop owns SessionStore
  → EventDispatcher::emit(&mut store, UserPromptCommitted)
  → SessionStore::commit(TurnEvent)
  → commit_from_event
  → commit_item
```

### 单测直接 append

```rust
store.commit_item(SessionItemDraft::UserMessage {
    turn: 0,
    text: "hello".into(),
})?;
```

仅用于 session 自身单测；loop 与生产 agent 禁止绕过 event。

### Fork

```rust
let child = store.fork(&sessions_dir, &boundary_item_id)?;
```

`fork` 创建新 Session，不是 `Clone`：新 session_id、parent metadata 和独立 log；boundary 必须是某 Turn 的最后一条 item。

---

## 配置与并发边界

| 项 | 约定 |
|----|------|
| 目录 | 由 agent/cli 注入；默认 `.moontide/sessions/{YYYY-MM-DD}/` |
| 环境变量 | session 不读取 |
| `session_id` | UUID |
| runtime writer | 一个 AgentLoop 独占一个 SessionStore |
| 跨实例 lease | R1 不实现；同时写同一 session 不支持 |

`turn(&mut self)` 只解决同一 AgentLoop 内串行，不声称对两个进程/实例提供互斥。等真实第二 writer 出现，再设计 file lock、lease 过期和恢复策略。

---

## 常见错误

| 现象 | 原因 |
|------|------|
| seq 断号 | log 损坏或不支持的并发写 |
| fork 失败 | boundary 不是 Turn 末条 |
| loop 直接 `commit_item` | 应 emit Committable TurnEvent |
| EventDispatcher 拥有 store | 会迫使共享/Mutex，破坏 AgentLoop 独占所有权 |
| 把 `fork` 叫 `clone` | fork 创建有父关系的新 Session，不是句柄复制 |
| 失败后复用已 append 的 turn number | append-only 事实不能回滚或重写 |

---

## 与相邻模块

| 模块 | 关系 |
|------|------|
| [`loop`](../loop/README.md) | runtime owner；读 items/next_turn；不直接 append |
| [`event`](../event/README.md) | 每次 emit 短借 SessionStore 作为 CommitHandler |
| `context` | 只读 `items()` → materialize |
| `llm::protocol` | Assistant blocks 类型复用 |
| `tools` | 直接持久化 ToolCall / ToolResult |

类型字段、append 算法、迁移分期和不变量见 [`DESIGN.md`](DESIGN.md)。
