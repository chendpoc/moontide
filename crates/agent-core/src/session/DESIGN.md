# session — 技术设计

> **读者：** 实现者、代码审查。对外集成见 [`README.md`](README.md)。
> **状态：** R1–R3、Session v2 tool payload 与 Loop R1 next-turn / mutable commit 接缝已实现。
> **关联：** [`../loop/DESIGN.md`](../loop/DESIGN.md) · [`../event/DESIGN.md`](../event/DESIGN.md) · [`crates/docs/agent-core.md`](../../../docs/agent-core.md) · [`UBIQUITOUS_LANGUAGE.md`](../../../../UBIQUITOUS_LANGUAGE.md)

---

## 1. 职责与边界

维护 **Session Item Log**（append-only 事实源）与外置 **SessionHeader**。

| 做 | 不做 |
|----|------|
| create/load/append/fork/items | materialize（context） |
| id/seq/at 分配与恢复校验 | Turn/Step 状态机（loop） |
| TurnEvent → SessionItem mapping | EventDispatcher / Hook |
| next turn cursor 计算 | 跨实例 Session lease |

**唯一物理写盘入口：** `SessionStore::commit_item`。生产调用链必须是 `loop emit → SessionStore CommitHandler → commit_from_event → commit_item`。

SessionStore 是 AgentLoop 的 non-Clone、独占运行时状态。R1 不用 `Arc<Mutex<_>>`，也不为尚不存在的第二 writer 建立 OS lock。

---

## 2. 持久化布局

```text
{sessions_dir}/
├── {session_id}.meta.json    # SessionHeader
└── {session_id}.log.jsonl    # 一行 JSON = 一个 SessionItem
```

- `sessions_dir` 由 agent/cli 注入；session 不读 env；
- `session_id` 是 UUID；create/load 校验以防路径逃逸；
- R1 全量 load 进内存，大 log 流式迭代后置；
- header 不进入 Session Item Log。

---

## 3. 模块结构（目标）

```text
session/
  README.md
  DESIGN.md
  TASKS.md
  mod.rs
  types.rs
  store.rs
  file_store.rs
  commit.rs            # commit_from_event + CommitHandler impl
  tests.rs
```

Loop 接缝批删除 `commit_handler.rs` 的 Mutex wrapper。若为迁移短期保留文件，最终公开 API 仍不得暴露 `SessionCommitHandler`。

---

## 4. 类型

### 4.1 `SessionItemBase`

```rust
pub struct SessionItemBase {
    pub id: String,
    pub seq: u64,
    pub session_id: String,
    pub turn: u64,
    pub at: String,
}
```

一行 JSONL = 一个 SessionItem，无 LogEnvelope。

### 4.2 `SessionItem`

```rust
pub enum SessionItem {
    UserMessage {
        base: SessionItemBase,
        text: String,
    },
    AssistantMessage {
        base: SessionItemBase,
        blocks: Vec<ContentBlock>,
    },
    ToolCall {
        base: SessionItemBase,
        call: ToolCall,
    },
    ToolResult {
        base: SessionItemBase,
        result: ToolResult,
    },
    Compaction { /* current fields */ },
    CheckpointCreated { /* current fields */ },
}
```

AssistantMessage 只允许 Text/Thinking；ToolUse/ToolResult 分别持久化为独立 tool items。Session 不解释 `ToolResultStatus`，只验证 identity 并持久化 canonical payload。

当前 header version 是 v2：新行使用 `tool_call` / `tool_result`，ToolContent 带 `{ type, value }` tag。v1 legacy kind 可读取；缺失 status → OutcomeUnknown，string content → Text，其他 JSON → Json。加载 v1 后 append 新行不重写旧行；fork 产生纯 v2 child；未知 version 拒绝。

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

### 4.4 `SessionItemDraft`

Draft 只有 `turn` + payload，不含 id/seq/session_id/at。由 store 校验后冻结。

### 4.5 `SessionStore`

```rust
pub struct SessionStore {
    header: SessionHeader,
    items: Vec<SessionItem>,
    next_seq: u64,
    store: FileSessionStore,
}

impl SessionStore {
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

    pub(crate) fn next_turn(&self) -> anyhow::Result<u64>;
}
```

SessionStore 不实现 Clone。`fork` 是领域操作，创建新 identity/log，不是 Rust 句柄复制。

### 4.6 Event commit seam

```rust
pub fn commit_from_event<'a>(
    store: &'a mut SessionStore,
    event: &TurnEvent,
) -> anyhow::Result<&'a SessionItem>;

impl crate::event::CommitHandler for SessionStore {
    fn commit(
        &mut self,
        event: &TurnEvent,
    ) -> anyhow::Result<Option<String>>;
}
```

mapping：

| TurnEvent | SessionItem |
|-----------|-------------|
| UserPromptCommitted | UserMessage |
| AssistantFinalized | AssistantMessage |
| ToolCallRecorded | ToolCall |
| ToolResultRecorded | ToolResult |
| CompactionApplied | Compaction |

非 Committable event 返回错误；EventDispatcher 不应对它调用 commit。

`CommitHandler::commit` 在 `commit_from_event` 后复制新 item id 返回，供 TraceContext 的 `session_item_id` correlation 使用。它不持有 store，不需要 Send/Sync 或 Mutex。

---

## 5. `commit_item` 算法

```text
commit_item(draft):
  1. validate_draft
  2. assign id = uuid
  3. assign seq = next_seq with checked increment
  4. assign at = now
  5. freeze SessionItem and serialize
  6. append file
  7. push items + advance next_seq
  8. return last item
```

实现必须保证 append 失败不让内存声称成功。当前实现的具体“先内存再文件并回滚”或“先文件再内存”顺序以已通过测试的代码为准；Loop 接缝批不得改变其原子性。

---

## 6. `next_turn` 与 Turn 消费点

```text
next_turn():
  items.last()
    None       → 0
    Some(item) → item.base.turn.checked_add(1)
```

不变量：

1. 只读，不修改 cursor 或文件；
2. empty session → 0；
3. checked overflow → Err；
4. caller 不能传 turn number；
5. `UserPromptCommitted` commit 成功才消费编号；
6. commit 后的 Turn 失败不回滚、不复用编号；
7. 下一 Turn 仍由 last item 推导，因此失败 Turn 中后续 facts 保持同一 turn。

新 UserMessage 前，AgentLoop 先对已有 items 调 `context::materialize`。该 preflight 属于 loop；session 不反向 import context。

---

## 7. 与 event / loop 协作

```text
agent create/load/fork SessionStore
    │ move
    ▼
AgentLoop
    │
    ├─ context::materialize(session.items())
    ├─ session.next_turn()
    └─ events.emit(&mut session, TurnEvent)
           │
           ├─ committable → SessionStore::commit
           │                  → commit_from_event → commit_item
           └─ post-commit Hook
```

生产约束：

- loop 持有 SessionStore，但不直接调用 `commit_item`；
- EventDispatcher 只短借 `&mut dyn CommitHandler`；
- session 不持有 EventDispatcher 或 Hook；
- AgentLoop 构造后 agent 不保留第二个 writer。

Resume：`load → validate/replay → items → materialize`，不需要 EventDispatcher。

---

## 8. 单 writer 与不支持的并发

`turn(&mut self)` 保证一个 AgentLoop 实例内 Turn 串行。它不协调：

- 两个 AgentLoop 同时 load 同一个 session；
- 两个进程同时 append 同一 log；
- 外部直接修改 JSONL。

R1 明确把这些视为 unsupported，而不是隐式安全。当前架构没有第二个合法 runtime writer，提前加入 file lock/lease 会引入 owner、过期、崩溃恢复与跨平台语义而没有消费者。

未来只有出现真实并发 writer 后，才评审：lock file、lease identity/TTL、stale recovery、read-only follower 和 fork 协调。

---

## 9. import 边界

```text
session → llm::protocol（ContentBlock）
session → tools（ToolCall / ToolResult）
session → event（TurnEvent + CommitHandler seam）

loop → SessionStore public/crate-private API
context → SessionItem read-only contract
agent → create/load/fork then move

session ↛ loop / context / model_input / agent / cli
```

session 对 event 的依赖只限稳定的 TurnEvent/CommitHandler seam；event 不 import SessionStore，因此没有环。

---

## 10. 不变量

1. `seq == items.len()`，从 0 连续；断号拒绝；
2. 先校验再冻结，外部输入错误不 panic；
3. AssistantMessage 不含 tool blocks；
4. header 不进 log；
5. `commit_item` 是唯一物理 append；
6. 生产 loop 只经 TurnEvent commit；
7. 每行 session_id 与 header 一致；
8. 只读取 v1 与当前 version；
9. tool item 直接包装 canonical ToolCall/ToolResult；
10. SessionStore non-Clone，AgentLoop 独占；
11. next_turn 只读且 checked；
12. append 成功后的 turn number 不回滚或复用；
13. EventDispatcher 不长期拥有 store；
14. R1 不宣称跨实例 concurrent writer 安全。

---

## 11. 边界情况

| 场景 | 处理 |
|------|------|
| seq 断号 | load Err |
| JSONL 损坏 | load Err，包含行号 |
| empty log | load 合法，next_turn=0 |
| last turn=u64::MAX | next_turn Err |
| fork boundary 非 Turn 末条 | Err |
| 流式 assistant 未 finalized | 无 SessionItem |
| commit non-committable event | Err |
| 同 session 多 writer | unsupported；可能由 load/seq 校验暴露，但无互斥承诺 |
| Turn 中途失败 | 已有 items 保留，下一 Turn 由最后 item 计算编号 |

---

## 12. `fork`

```text
fork(boundary_item_id):
  1. 定位 boundary，要求该 Turn 的最后一条 item
  2. new session_id，parent_session = source id
  3. 复制 prefix，重新连续 seq
  4. 保留原 item.id，seed_len = prefix length
  5. 写独立 header/log
```

Fork 返回新的 SessionStore 所有权；调用方决定把 source 或 child 移入 AgentLoop，不能把两者误当同一 session 的两个 writer。

---

## 13. 决策记录

1. 一行 JSONL = 一个 SessionItem，无 Envelope；
2. ToolCall/ToolResult 分行，materialize 归 context；
3. seq 表位置，id 表身份；
4. Turn boundary/trace 不进事实源；
5. loop 经 TurnEvent commit，不直接 append；
6. v2 typed tool payload，v1 缺失 status → OutcomeUnknown；
7. SessionStore 由 AgentLoop 独占且 non-Clone；
8. EventDispatcher 每次借 mutable commit，不拥有 store；
9. 删除 Mutex-based SessionCommitHandler；
10. next turn 由最后 item 推导，调用者不传入；
11. UserMessage commit 后编号永久消费，失败不回滚；
12. R1 无 Session lease，跨实例同 session 写入不支持；
13. fork 是新 Session 的领域操作，不是 clone。

---

## 14. 实现分期

| 批 | 范围 | 状态 |
|----|------|------|
| R1 | types + file/store create/load/commit | 已实现 |
| R2 | fork + compaction/checkpoint item | 已实现 |
| R3 | commit_from_event + old SessionCommitHandler | 已实现 |
| R3-F1 | v2 ToolCall/ToolResult + v1 migration | 已实现 |
| Loop R1-B | next_turn + direct CommitHandler impl + remove Mutex wrapper | 已实现 |

---

## 15. 单测方向

- seq 连续、断号/损坏行拒绝；
- Assistant tool blocks 拒绝；
- create/commit/load 往返与 file failure 原子性；
- v2 typed payload、v1 load、unknown version；
- fork boundary/parent/seed/seq；
- empty / resumed / u64::MAX next_turn；
- next_turn 只读且不预占编号；
- SessionStore 直接 CommitHandler mapping 与 returned item id；
- EventDispatcher 连续借用同一 store，registry 不拥有它；
- SessionCommitHandler/Mutex 从目标 API 消失；
- session 不 import loop/context/agent；
- concurrent same-session writer 不被测试错误宣称为支持。
