# session — 技术设计

> **读者：** 实现者、代码审查。对外集成见 [`README.md`](README.md)。
> **状态：** 已定稿（2026-08-15）；R1–R3 已实现，测试通过。
> **关联：** [`DESIGN.md`](../event/DESIGN.md) · [`docs/spec/context-composer.md`](../../../../docs/spec/context-composer.md) · [`UBIQUITOUS_LANGUAGE.md`](../../../../UBIQUITOUS_LANGUAGE.md)

---

## 1. 职责与边界

维护 **Session Item Log**（append-only 事实源）与 **SessionHeader**（外置元数据）。

| 做 | 不做 |
|----|------|
| `create` / `load` / `commit_item` / `fork` / `items()` | `materialize`（context） |
| 不变量校验、`id`/`seq` 分配 | `compile`（context / prompt） |
| `commit_from_event`（R3） | RunEvent Pipeline 引擎（event） |
| | turn 生命周期观测（Agent Event Log） |

**唯一写盘：** `SessionStore::commit_item` → `{session_id}.log.jsonl`。

---

## 2. 持久化布局

```text
{sessions_dir}/
├── {session_id}.meta.json    # SessionHeader
└── {session_id}.log.jsonl    # 一行 JSON = 一个 SessionItem
```

- `sessions_dir` 由 agent/cli 注入；mod 内不读 env。
- `session_id`：UUID；create/load 校验，防路径逃逸。
- R1：全量 load 进内存；大 log 流式迭代后置。

---

## 3. 模块结构（计划）

```text
session/
  README.md           # 对外使用说明
  DESIGN.md           # 本文
  mod.rs
  types.rs            # SessionItem, SessionHeader, SessionItemDraft, SessionItemBase
  store.rs            # SessionStore
  file_store.rs       # FileSessionStore（pub(crate) IO）
  commit.rs           # commit_from_event（R3）
  tests.rs
```

---

## 4. 类型

### 4.1 `SessionItemBase`

```rust
pub struct SessionItemBase {
    pub id: String,           // UUID；commit 时分配
    pub seq: u64,             // == 行号，从 0 连续
    pub session_id: String,
    pub turn: u64,
    pub at: String,           // ISO 8601
}
```

一行 jsonl = 一个 `SessionItem`（base + payload），无 `LogEnvelope`。

### 4.2 `SessionItem`

```rust
pub enum SessionItem {
    UserMessage      { base: SessionItemBase, text: String },
    AssistantMessage { base: SessionItemBase, blocks: Vec<ContentBlock> },
    ToolInvocation   { base: SessionItemBase, tool_use_id: String, name: String, input: Value },
    ToolOutcome      { base: SessionItemBase, tool_use_id: String, content: ToolResultContent },
    // R2+：Compaction · CheckpointCreated · Routing
}
```

- `ContentBlock` / `ToolResultContent` / `Value` ← `crate::llm::protocol`
- **AssistantMessage.blocks** 仅 `Text` / `Thinking`；tool 独立条目

### 4.3 `SessionHeader`

```rust
pub struct SessionHeader {
    pub version: u32,
    pub session_id: String,
    pub cwd: PathBuf,
    pub parent_session: Option<String>,
    pub seed_len: u64,
}
```

header **不进** log。

### 4.4 `SessionItemDraft`

调用方提供 `turn` + payload；**不含** `id` / `seq` / `at` / `session_id`（store 写入）。

### 4.5 `SessionStore`

```rust
pub struct SessionStore {
    header: SessionHeader,
    items: Vec<SessionItem>,
    next_seq: u64,
    store: FileSessionStore,
}

impl SessionStore {
    pub fn create(sessions_dir: impl AsRef<Path>, cwd: PathBuf) -> Result<Self>;
    pub fn load(sessions_dir: impl AsRef<Path>, session_id: &str) -> Result<Self>;
    pub fn commit_item(&mut self, draft: SessionItemDraft) -> Result<&SessionItem>;
    pub fn fork(&self, sessions_dir: impl AsRef<Path>, boundary_item_id: &str) -> Result<Self>;
    pub fn items(&self) -> &[SessionItem];
    pub fn header(&self) -> &SessionHeader;
}
```

### 4.6 `commit_from_event`（R3）

```rust
pub fn commit_from_event(
    store: &mut SessionStore,
    event: &RunEvent,
) -> anyhow::Result<&SessionItem>;
```

| `RunEvent` | `SessionItem` |
|------------|---------------|
| `UserPromptCommitted` | `UserMessage` |
| `AssistantFinalized` | `AssistantMessage` |
| `ToolInvocationRecorded` | `ToolInvocation` |
| `ToolOutcomeRecorded` | `ToolOutcome` |
| `CompactionApplied` | `Compaction`（R2+） |

非 Committable → `Err`。

---

## 5. `commit_item` 算法

```text
commit_item(draft):
  1. validate_draft(draft)           # 类型不变量、turn 粗校验
  2. assign id = new_uuid()
  3. assign seq = next_seq; next_seq += 1
  4. assign at = now_iso8601()
  5. freeze → SessionItem
  6. items.push(item)
  7. file_store.append_line(serde_json)
  8. return &items[last]
```

**原子性（R1）：** 先写内存再 append 文件；append 失败则内存回滚（或整体 `Err`，实现时二选一并写测试）。

---

## 6. 与 event / loop 协作

```text
  loop                          event::dispatch                 session
    │ emit Committable            │ hook → commit ────────────►│ commit_from_event
    │                             │      → observe             │   → commit_item
    │ emit Observational          │ observe only（不写 session）│
```

生产路径：**loop 不 import session**；commit 仅在 event Pipeline commit 阶段（agent 注册 handler）。

测试路径：可直接 `commit_item`（R1 守门单测）。

**resume（无 event）：**

```text
load → 重放 jsonl → items[] → context::materialize(items)
```

---

## 7. import 边界

```text
session ──► crate::llm::protocol

context  ──► session.items()（只读）
agent    ──► SessionStore + 注册 commit handler
event    ──► commit_from_event（经 handler，非直接 import store 内部）
loop     ──► （不 import session）
```

---

## 8. 不变量

1. `seq == items.len()`，从 0 连续；断号 → `Err`
2. 先校验后冻结；serde 可序列化再写盘
3. Assistant 不含 tool 块
4. header 不进 log
5. 单写者：`commit_item` 唯一写盘入口
6. `UserPromptCommitted` commit 先于 LLM（由 loop + event 顺序保证，非 session 职责）

---

## 9. 边界情况

| 场景 | 处理 |
|------|------|
| seq 断号 | `load` → `Err` |
| fork 非 turn 末条 | `Err` |
| 空 log | `load` 合法 |
| 流式未 Finalize | 无 SessionItem |
| 并发写 | 不支持；单进程单写者 |
| 损坏 jsonl 行 | `load` → `Err`（带行号） |

---

## 10. `fork`（R2）

```text
fork(boundary_item_id):
  1. 定位 boundary item；须为该 turn 最后一条
  2. 新 session_id；parent_session = self.session_id
  3. 复制 items[0..=boundary]；新 log 重编 seq
  4. 保留原 item.id；seed_len = 新 log 行数
```

Pi 式同文件树 fork 后置；R2 用新文件。

---

## 11. 决策记录

| # | 决策 |
|---|------|
| 1 | 一行 jsonl = 一个 `SessionItem`，无 Envelope |
| 2 | tool 拆 invocation / outcome；materialize 在 context |
| 3 | `seq`（位置）+ `id`（身份）双字段 |
| 4 | trace / turn 边界不进 Item Log |
| 5 | loop 经 RunEvent commit，不直接 append |
| 6 | R1 四类 item；Compaction 等 R2 |
| 7 | R1 ToolOutcome 全文；artifact spill 后 schema 只增不改 |
| 8 | 文件名 `.meta.json` + `.log.jsonl` |

---

## 12. 实现分期

| 批 | 范围 |
|----|------|
| **R1** | types + FileSessionStore + SessionStore create/load/commit + seq 守门单测 |
| **R2** | fork + Compaction/Checkpoint item 类型 |
| **R3** | `commit_from_event` + agent/event 联调 |

任务拆分见 `TASKS.md`（待写）。

---

## 13. 单测方向

- seq 连续性与断号拒绝
- Assistant blocks 含 ToolUse → `Err`
- create → commit × N → load 往返一致
- commit 后 `id`/`seq`/`at` 由 store 分配
- `commit_from_event` 映射表（R3）
- fork 边界校验（R2）
