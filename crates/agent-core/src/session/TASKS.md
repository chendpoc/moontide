# session 实现子任务

> [`README.md`](README.md) · [`DESIGN.md`](DESIGN.md) · [`batch-implement`](../../../../.agents/skills/moontide-kernel-plan/batch-implement/SKILL.md)

**TASK** = 实现跟踪（细）。**Review 批** = 你 `git diff` 的单位（合并 TASK，目标 ~300–1500 行，上限 2000）。

---

## Review 批

| 批 | TASK | 主题 | 状态 |
|----|------|------|------|
| **R1** | 01–05 | types + FileSessionStore + SessionStore create/load/commit + 不变量单测 | ☑ |
| **R2** | 06–08 | fork + Compaction/Checkpoint item 类型 | ☑ |
| **R3** | 09–10 | commit_from_event + agent/event 联调 | ☑ |
| **R3-F1** | 11 | Session v2 ToolCall / ToolResult payload 迁移 | ☑ |
| **R4** | 12–13 | next_turn + direct mutable CommitHandler | ☐ |

---

## R1：types + store + commit + 守门单测

### TASK-session-01: 类型定义

- **做什么：** `SessionItemBase`、`SessionItem`、`SessionItemDraft`、`SessionHeader`；serde tag + flatten base；复用 `llm::protocol`。
- **范围：** `types.rs`、`mod.rs` re-export。
- **完成标准：** serde round-trip；四类 item 可序列化。
- **状态：** ☑

### TASK-session-02: FileSessionStore

- **做什么：** `pub(crate)` IO：`{session_id}.meta.json` + `{session_id}.log.jsonl`；`session_id` UUID 校验防路径逃逸；create / load / append_line。
- **范围：** `file_store.rs`。
- **完成标准：** 损坏 jsonl 行号报错；空 log 合法。
- **状态：** ☑

### TASK-session-03: SessionStore create / load

- **做什么：** `create`、`load`；全量 load 进内存；`next_seq` 与 `items.len()` 对齐；seq 断号拒绝。
- **范围：** `store.rs`。
- **完成标准：** create → load 往返 header + items 一致。
- **状态：** ☑

### TASK-session-04: commit_item

- **做什么：** validate → assign id/seq/at → 内存 push → append；失败回滚；`items()` / `header()` 只读访问。
- **范围：** `store.rs`。
- **状态：** ☑

### TASK-session-05: 不变量单测

- **做什么：** seq 连续与断号；Assistant tool 块拒绝；create → commit × N → load 往返；`pub mod session` 导出。
- **范围：** `tests.rs`、`lib.rs`。
- **完成标准：** `cargo test -p agent-core` 全绿。
- **状态：** ☑

---

## R2：fork + 扩展 item 类型

### TASK-session-06: fork

- **做什么：** `SessionStore::fork`；boundary 须为 turn 末条；新 session 复制 items 重编 seq；`parent_session` / `seed_len`。
- **范围：** `store.rs`、`file_store.rs`。
- **完成标准：** fork 边界校验单测；子 session load 一致。
- **状态：** ☑

### TASK-session-07: Compaction / Checkpoint item

- **做什么：** `SessionItem` / `SessionItemDraft` 扩展 Compaction、CheckpointCreated 等 R2+ 类型。
- **范围：** `types.rs`。
- **完成标准：** serde round-trip；DESIGN §4.2 对齐。
- **状态：** ☑

### TASK-session-08: R2 集成测试

- **做什么：** fork 往返 + 扩展类型 commit/load。
- **范围：** `tests.rs`。
- **完成标准：** `just check`。
- **状态：** ☑

---

## R3：commit_from_event

### TASK-session-09: commit_from_event

- **做什么：** `commit.rs`；Committable `TurnEvent` → `SessionItemDraft` → `commit_item`；非 Committable → `Err`。
- **范围：** `commit.rs`、`mod.rs`。
- **完成标准：** 映射表单测（UserPromptCommitted / AssistantFinalized / ToolCallRecorded / ToolResultRecorded）。
- **状态：** ☑

### TASK-session-10: agent/event 联调

- **做什么：** event commit handler 注册；生产路径不写盘绕过 Pipeline。
- **范围：** `agent` + `event`（跨模块）。
- **完成标准：** 集成测试或 conformance 守门。
- **状态：** ☑

---

## R3-F1：Session v2 tool payload

### TASK-session-11: 直接持久化 ToolCall / ToolResult

- **做什么：** 将 tool item/draft 收敛为 `ToolCall` / `ToolResult`；header 升到 v2；兼容读取 v1 历史 kind，并将缺失 status 映射为 `OutcomeUnknown`。
- **依赖：** agent-core tools RB2
- **范围：** `types.rs`、`store.rs`、`commit.rs`、`tests.rs`
- **完成标准：** 新写入不复制 tool 字段；v1 load、typed status、未知 header version 与 event commit 测试通过。
- **状态：** ☑

---

## R4：Loop ownership 接缝

### TASK-session-12: next_turn

- **做什么：** 增加 crate-private `SessionStore::next_turn()`；empty→0，last turn checked +1，溢出 Err；只读且不预占编号。
- **范围：** `store.rs`、`tests.rs`
- **完成标准：** empty/resume/failed-turn cursor 与 u64::MAX 测试通过。
- **状态：** ☐

### TASK-session-13: direct mutable CommitHandler

- **做什么：** SessionStore 直接实现 event::CommitHandler；移除 Mutex-based SessionCommitHandler 与公开 re-export。
- **依赖：** TASK-event-16
- **范围：** `commit.rs`、`commit_handler.rs`、`mod.rs`、`tests.rs`
- **完成标准：** EventDispatcher 每次短借同一个 store；mapping/returned item id 不变；无 Arc/Mutex ownership。
- **状态：** ☐
