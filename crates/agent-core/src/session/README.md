# session

维护 **Session Item Log**（append-only 事实源）与外置 **SessionHeader**；负责 create/load/append/fork 与只读查询，不做 materialize、Turn 状态机或观测日志。

**设计：** [`DESIGN.md`](../../DESIGN.md#session)

## 公开入口

- `SessionStore` — `create` / `load` / `fork` / `commit_item` / `items` / `header` / `latest_session_id`
- `SessionItem`、`SessionItemDraft`、`SessionItemBase`、`SessionHeader` — log 条目与 header
- `SessionQuery`、`SessionSummary`、`SessionSnapshot`、`SessionTurnPage` — 只读列举与加载
- `commit_from_event` — `TurnEvent` → `SessionItem` mapping（内部）
- `impl event::CommitHandler for SessionStore` — loop 经 event 同步 commit 的 mutable seam
- `SessionStore::next_turn()` — crate-private 只读 cursor（empty → 0；否则 last turn + 1）

持久化布局：`{sessions_dir}/{YYYY-MM-DD}/{session_id}.meta.json` + `{session_id}.log.jsonl`。唯一物理 append 入口是 `commit_item`；生产路径为 `loop emit → CommitHandler → commit_from_event → commit_item`。

`SessionStore` 为 non-Clone；AgentLoop 独占 runtime ownership。R1 无跨实例 file lease。

## 调用边界

| 调用者 | 可用 | 禁止 |
|--------|------|------|
| `agent` | create / load / fork，移入 `AgentLoopInit` | 构造 loop 后保留第二个 writer |
| `loop` | `items()`、`next_turn()`，借出 store 作 commit target | 直接 `commit_item` |
| `context` | 只读 `items()` slice | append / fork |
| `event` | 短借 `&mut SessionStore` 作 `CommitHandler` | 长期拥有 store |

## 相邻模块

[`loop`](../loop/README.md) · [`event`](../event/README.md) · [`context`](../context/README.md) · [`tools`](../tools/README.md) · [`llm`](../llm/README.md)
