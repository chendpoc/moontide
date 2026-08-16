# session

> **对外使用说明** — 集成 `agent-core::session` 时读本文即可。
> **实现细节** — [`DESIGN.md`](DESIGN.md)
> **状态：** R1–R3 与 v2 tool payload 迁移已实现（store · fork/compaction · typed commit）。
> **关联：** [`../event/README.md`](../event/README.md) · [`crates/docs/agent-core.md`](../../../docs/agent-core.md)

---

## 这是什么

`session` 维护整场对话的 **Session Item Log**（append-only 事实源）：

```text
.moontide/sessions/
├── {session_id}.meta.json      # 元数据（cwd、fork 关系）
└── {session_id}.log.jsonl      # 每行一条 SessionItem
```

**一句话：** 只负责「记什么」；不负责「发给模型什么」（`context`）或「运行 trace」（`event`）。

---

## 设计原理（brief）

```text
  Session Item Log     ≠     Agent Event Log     ≠     LLMRequest
  （事实 · 本模块）         （观测 · event）          （编译 · context）
        │                         ▲
        │    emit → commit 阶段    │
        └─────────────────────────┘
              loop 不直接写 session
```

- **唯一写盘：** `SessionStore::commit_item`（生产路径经 `event` commit 阶段调用）
- **resume：** `load` → `items()` → `context::materialize`
- **不进 log：** `TurnStart`、流式 delta、trace（归 Agent Event Log）
- **tool：** `ToolCall` / `ToolResult` 分行存储并直接包装 tools 契约；assistant 条目不嵌 tool 块

---

## 谁该用什么

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| **`agent`** | `create` / `load`、持有 `SessionStore`、注册 `commit_from_event` | — |
| **`loop`** | — | **任何** session API |
| **`context`** | `items()` 只读 | `commit_item` |
| **`event`** commit handler | `commit_from_event` | 绕过 Pipeline 写盘 |
| **`cli`** | `load` + `items()` | `commit_item` |
| **测试** | 全 API | — |

---

## 公开 API

```rust
impl SessionStore {
    pub fn create(sessions_dir: impl AsRef<Path>, cwd: PathBuf) -> Result<Self>;
    pub fn load(sessions_dir: impl AsRef<Path>, session_id: &str) -> Result<Self>;
    pub fn commit_item(&mut self, draft: SessionItemDraft) -> Result<&SessionItem>;
    pub fn fork(&self, sessions_dir: impl AsRef<Path>, boundary_item_id: &str) -> Result<Self>; // R2
    pub fn items(&self) -> &[SessionItem];
    pub fn header(&self) -> &SessionHeader;
}

pub fn commit_from_event(store: &mut SessionStore, event: &RunEvent) -> Result<&SessionItem>; // R3

impl SessionCommitHandler {
    pub fn new(store: SessionStore) -> Self; // R3：实现 event::CommitHandler
}
```

**Draft 规则：** 只填 `turn` + 载荷；**不要**自填 `id` / `seq` / `at`。

**条目类型：** `UserMessage` · `AssistantMessage` · `ToolCall` · `ToolResult` · `Compaction` · `CheckpointCreated`

当前写入 schema 是 v2：`SessionItem::ToolCall` flatten `tools::ToolCall`，`SessionItem::ToolResult` flatten `tools::ToolResult`，完整保留 typed status；`ToolContent` 以显式 `{ type, value }` tag 区分 Text 与任意 JSON。读取 v1 时兼容旧 kind，缺失 status 的历史结果映射为 `OutcomeUnknown`，历史 string content 映射为 Text、其他 JSON 形状映射为 Json；加载后的 v1 session 继续 append 时保留旧行并写当前 kind/tag，读取器仅对 legacy kind 迁移，fork 则生成纯 v2 子 session。未知 header version 直接拒绝。

---

## 典型用法

### 生产路径（推荐）

经 `event` 写入，保证 hook 与 observe 一致：

```text
agent 持有 SessionStore
loop.emit(UserPromptCommitted { … })
  → event commit 阶段 → commit_from_event → commit_item
```

详见 [`../event/README.md`](../event/README.md)。

### 新建会话

```rust
let mut store = SessionStore::create(".moontide/sessions", cwd)?;
```

### Resume

```rust
let store = SessionStore::load(".moontide/sessions", &session_id)?;
let items = store.items(); // → context::materialize
```

### 单测直接写盘

```rust
store.commit_item(SessionItemDraft::UserMessage {
    turn: 0,
    text: "hello".into(),
})?;
```

仅测试 / R1 守门；**loop 与生产 agent 路径禁止**直接 `commit_item`。

### Fork（R2）

```rust
let child = store.fork(".moontide/sessions", &boundary_item_id)?;
```

`boundary_item_id` 须为该 `turn` 的最后一条 item。

---

## 配置

| 项 | 约定 |
|----|------|
| 目录 | `sessions_dir` 由 **agent/cli 注入**；默认 `.moontide/sessions` |
| 环境变量 | 本模块 **不读取** |
| `session_id` | UUID |

---

## 常见错误

| 现象 | 原因 |
|------|------|
| seq 断号 | log 损坏或并发写（禁止多写者） |
| fork 失败 | boundary 不是 turn 末条 |
| loop 里调 `commit_item` | 应 `emit` Committable `RunEvent` |
| 流式中途写 assistant | 应等 `AssistantFinalized` |

---

## 与相邻模块

| 模块 | 关系 |
|------|------|
| [`event`](../event/README.md) | Committable 事件 → `commit_from_event` |
| `context` | 只读 `items()` → materialize |
| `llm::protocol` | `ContentBlock` 等类型复用 |
| `tools` | 直接持久化 `ToolCall` / `ToolResult` 契约 |

实现分期、类型字段、不变量全文见 [`DESIGN.md`](DESIGN.md)。
