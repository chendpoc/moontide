
> Session 终局架构：内存 `SessionContext` 仅含 `messages`；非对话行写入 **Session Item Log** + State Stores；每 turn 由 **`composeContext`** 编译 LLM 输入。

## 类型

| 类型 | 角色 |
|------|------|
| **`SessionMessage`** | 对话 domain 条目（`role` + `content` + metadata） |
| **`SessionContext`** | `{ messages: SessionMessage[] }`，**内存真相** |
| **`SessionItem`** | 持久化 DTO，一行 NDJSON（含 user/assistant/tool 与 compaction/checkpoint/routing） |
| **`Message`** | [`llm/protocol`](../../packages/llm/src/protocol/types.ts)，`LLMRequest.messages` |
| **`CompactionSave`** | summary / structured 压缩产物（CompactionStore） |
| **`Checkpoint`** | 可恢复快照（CheckpointStore） |
| **`Artifact`** | 大 tool 输出全文（ArtifactStore） |

非对话 SessionItem kind：`compaction` · `checkpoint_created` · `routing` — **不进** `SessionContext.messages`。

## 数据流

```
Agent appendUser/Assistant/Tool → SessionContext.messages（内存）
                                 ↓ itemsFromMessages（write-through）
                              Session Item Log (.moontide/sessions/<id>.jsonl)
                                 ↑ 计划：commit 经 SessionItemCommitPort（Harness 注入），非 Session 内 hook

Agent appendCompactionItem / appendCheckpointItem / appendRoutingItem
  → Session Item Log only（+ Store 按需）

SessionContext.messages → messagesFromContext → Message[]
  → composeContext（applyTailWindow / applySummary / applyPrune）
  → toMessageParams → LLM API

cold start: jsonl → messagesFromItems → SessionContext.messages
```

## 模块

| 路径 | 职责 | 计划变更 |
|------|------|----------|
| [`src/session/session.ts`](../../packages/session/src/session.ts) | 持有 `messages[]`，`append*`，经 port 落盘 | **`SessionItemCommitPort`**（[架构修复 §1](architecture-remediation.md) · 已实现） |
| [`src/session/transform/`](../../packages/session/src/transform/) | `messagesFromItems` · `itemsFromMessages` · `messagesFromContext` | — |
| [`packages/session/src/item-handlers.ts`](../../packages/session/src/item-handlers.ts) | `applyItemToMessages`（materialize） | Legacy Item derive 已删；Agent Event 见 [`run-event-derive.ts`](../../apps/moontide/src/log/run-event-derive.ts)（[§3](architecture-remediation.md) · done） |
| [`src/session/io/`](../../packages/session/src/io/) | SessionItem ↔ jsonl；`FileSessionItemWriter` | Writer 由 Harness port 调用（[§10](architecture-remediation.md)） |
| [`src/context/stores/`](../../packages/session/src/stores/) | CompactionSave / Checkpoint / Artifact FS stores | 目标 **`session/stores/`** |
| [`src/context/composer/`](../../packages/context-composer/src/) | **`composeContext`** — 唯一 LLM 输入出口 | — |
| [`src/plugins/builtin/session-persistence/`](../../apps/moontide/src/plugins/builtin/session-persistence/) | Session Index · `/save` · `/resume session` · exit auto-save | — |
| [`src/context-inspect/`](../../apps/moontide/src/context-inspect/) | context 观测 · `/debug` emit | — |
| [`src/log/`](../../apps/moontide/src/log/) | **Agent Event Log**（与 Session Item Log 严格区分） | — |

## Invariant

1. **`SessionContext`** = `{ messages }` only。
2. **`composeContext`** 是唯一 LLM 输入出口；热路径 **不** `readLog()`、**不** `composeContextV1`。
3. Compaction **不 splice** Item Log / `messages`；只改 Composer 输出（`applyPrune` / `applySummary` / `applyTailWindow`）。
4. jsonl schema 不变（含 legacy 字段 `compactionRecordId`）；新 TS/Manifest 用 `CompactionSave`、`coversItemIds`、`lastItemId`、`activeCompactionSaveId`。
5. 超大 tool 输出（默认 >8KB，`MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES`）→ **ArtifactStore** + Item Log `tool_outcome.artifactId`；模型只见 `formatToolSummary`。
6. **Checkpoint** 快照：`/checkpoint` + `/resume <checkpoint-id>`（同 session）；跨 REPL 加载用 `/resume session <session-id>` — 见 [session-persistence.md](session-persistence.md)。
7. **`/compact summary`** → **CompactionSave** + `compaction` Item；compose 经 `applySummary` 注入摘要。
8. **Session Index** — `exit` / `/reset` / `/save` 维护 `.moontide/sessions/index.json`；Item Log 仍为事实源。

## 相关文档

| 文档 | 关系 |
|------|------|
| [`context-composer.md`](../spec/context-composer.md) | 主 Spec（C0–C6） |
| [`architecture-remediation.md`](architecture-remediation.md) | Session port · Phase A–C |
| [`context-window-roadmap.md`](context-window-roadmap.md) | 六件事 + Budget Tiers **done** · §8 后续四条轨 · Provider D–I backlog |
| [`session-log-migration.md`](session-log-migration.md) | C1 迁移策略 |
| [`session-persistence.md`](session-persistence.md) | Index 书签 · `/save` · `/resume session` |
| [`context-inspect-debug.md`](context-inspect-debug.md) | `/debug` 分级全量 dump |
| [`agent-run-hooks.md`](agent-run-hooks.md) | #2–#3 Session Observe（**done**） |
| [`utils-infrastructure.md`](utils-infrastructure.md) | utils / storage / event-hub 分层 |
