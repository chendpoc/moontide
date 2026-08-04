# Session Domain Model（TypeScript）

> Session 终局架构：内存 `SessionContext` 仅含 `messages`；非对话行写入 **Session Item Log** + State Stores；每 turn 由 **`composeContext`** 编译 LLM 输入。

## 类型

| 类型 | 角色 |
|------|------|
| **`SessionMessage`** | 对话 domain 条目（`role` + `content` + metadata） |
| **`SessionContext`** | `{ messages: SessionMessage[] }`，**内存真相** |
| **`SessionItem`** | 持久化 DTO，一行 NDJSON（含 user/assistant/tool 与 compaction/checkpoint/routing） |
| **`Message`** | [`llm/protocol`](../../src/llm/protocol/types.ts)，`LLMRequest.messages` |
| **`CompactionSave`** | summary / structured 压缩产物（CompactionStore） |
| **`Checkpoint`** | 可恢复快照（CheckpointStore） |
| **`Artifact`** | 大 tool 输出全文（ArtifactStore） |

非对话 SessionItem kind：`compaction` · `checkpoint_created` · `routing` — **不进** `SessionContext.messages`。

## 数据流

```
Agent appendUser/Assistant/Tool → SessionContext.messages（内存）
                                 ↓ itemsFromMessages（write-through）
                              Session Item Log (.ocula/sessions/<id>.jsonl)

Agent appendCompactionItem / appendCheckpointItem / appendRoutingItem
  → Session Item Log only（+ Store 按需）

SessionContext.messages → messagesFromContext → Message[]
  → composeContext（applyTailWindow / applySummary / applyPrune）
  → toMessageParams → LLM API

cold start: jsonl → messagesFromItems → SessionContext.messages
```

## 模块

| 路径 | 职责 |
|------|------|
| [`src/session/session.ts`](../../src/session/session.ts) | 持有 `messages[]`，`append*`，增量落盘 |
| [`src/session/transform/`](../../src/session/transform/) | `messagesFromItems` · `itemsFromMessages` · `messagesFromContext` |
| [`src/session/item-handlers.ts`](../../src/session/item-handlers.ts) | `applyItemToMessages` · `deriveFromSessionItem`（Item → Message / Agent Event） |
| [`src/session/io/`](../../src/session/io/) | SessionItem ↔ jsonl |
| [`src/context/stores/`](../../src/context/stores/) | CompactionSave / Checkpoint / Artifact FS stores |
| [`src/context/composer/`](../../src/context/composer/) | **`composeContext`** — 唯一 LLM 输入出口 |
| [`src/log/`](../../src/log/) | **Agent Event Log**（与 Session Item Log 严格区分） |

## Invariant

1. **`SessionContext`** = `{ messages }` only。
2. **`composeContext`** 是唯一 LLM 输入出口；热路径 **不** `readLog()`、**不** `composeContextV1`。
3. Compaction **不 splice** Item Log / `messages`；只改 Composer 输出（`applyPrune` / `applySummary` / `applyTailWindow`）。
4. jsonl schema 不变（含 legacy 字段 `compactionRecordId`）；新 TS/Manifest 用 `CompactionSave`、`coversItemIds`、`lastItemId`、`activeCompactionSaveId`。
5. 超大 tool 输出（默认 >8KB，`OCULA_ARTIFACT_SPILL_THRESHOLD_BYTES`）→ **ArtifactStore** + Item Log `tool_outcome.artifactId`；模型只见 `formatToolSummary`。
6. **Checkpoint** 快照：`/checkpoint` + `/resume`；内存 `messages` 截到 `lastItemId`。
7. **`/compact summary`** → **CompactionSave** + `compaction` Item；compose 经 `applySummary` 注入摘要。

## 相关文档

| 文档 | 关系 |
|------|------|
| [`context-composer.md`](../spec/context-composer.md) | 主 Spec（C0–C6） |
| [`context-window-roadmap.md`](context-window-roadmap.md) | 六件事；#5 Provider 进行中 |
| [`session-log-migration.md`](session-log-migration.md) | C1 迁移策略 |
| [`agent-run-hooks.md`](agent-run-hooks.md) | #2–#3 Session Observe（**done**） |
| [`utils-infrastructure.md`](utils-infrastructure.md) | utils / storage / event-hub 分层 |
