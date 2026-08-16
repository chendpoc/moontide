> **已归档：** TypeScript 时代的 Agent Event 设计，仅供追溯。当前 Rust 设计见 [`event/DESIGN.md`](../../../crates/agent-core/src/event/DESIGN.md)。archive 内部链接可能已失效。

MoonTide 将单次 run 的观测 JSONL 称为 **Agent Event Log**（与 **Session Item Log** 区分；后者见 [`context-composer.md`](context-composer.md)）。

## Agent Event Log vs Session Item Log

| | Agent Event Log | Session Item Log |
|---|-----------------|-------------------|
| Scope | 单次 run | 整场 session |
| Path | `.moontide/runs/<runId>.active.jsonl` | `.moontide/sessions/<sessionId>.jsonl` |
| 职责 | trace、metrics、tool use log、UI tail | 会话事实 source of truth |
| Schema | 本文 + `src/log/types.ts` | [`context-composer.md` §5](context-composer.md#5-session-item-log--条目-spec) |

---

MoonTide writes one JSON object per line for the active run:

```text
workdir/.moontide/runs/<runId>.active.jsonl
```

Before an append would push the active file above 5 MiB, the complete existing
lines are sealed and compressed with gzip level 2:

```text
workdir/.moontide/runs/<runId>-0001.jsonl.gz
```

The final active segment is also compressed when the run completes. Compressed
segments are lossless archives; the desktop UI only tails the active JSONL.

TypeScript source: [`packages/log/src/types.ts`](../../packages/log/src/types.ts).

**Fan-out 入口：** [`@moontide/log` event-hub](../../packages/log/src/event-hub.ts)（`emit` · `subscribe`）+ [`packages/agent-cli/src/log/index.ts`](../../packages/agent-cli/src/log/index.ts)（装配 re-export）。Hook sidecar 与 **RunEvent derive** 经此写入 JSONL / stderr。

## Core fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event UUID |
| `seq` | number | Monotonic sequence within a run |
| `runId` | string | Run identifier and storage routing key |
| `turn` | number | Agent loop turn |
| `phase` | string | `pre_llm` \| `post_llm` \| `post_tool` \| `stop` |
| `channel` | string | `conversation` \| `trace` \| `context` \| `tool_use_log` |
| `kind` | string | Event kind |
| `ts` | number | Unix milliseconds |
| `payload` | object | Kind-specific persisted payload |
| `preview` | string? | Short UI/grep summary |
| `truncated` | boolean? | True when the persisted event exceeded 64 KiB |
| `originalBytes` | number? | Serialized size before truncation |

Persisted events also include `summary` and `displayHint`.

## Persistence serialization

- A persisted JSONL line is at most 64 KiB.
- Context reports omit `messageLines`, messages, system prompts, and tool
  schemas. They retain aggregate token, usage, structure, trend, and alert data.
- A committed trace `tool_use` stores structured `input` once; its duplicate
  JSON body is omitted. Streaming snapshots use `tool_use_update` and never
  masquerade as committed calls.
- Tool use log events store the tool name without duplicating tool input or output.
- Runtime `AgentEvent` objects remain unchanged; size limits apply only at the
  storage boundary.

## Channel payloads

| Channel/kind | Persisted payload |
|--------------|-------------------|
| `conversation/user_prompt` | `{ text }` |
| `conversation/final` | `{ text }` |
| `trace/thinking` | `{ body, charCount, llmCallId, step }` |
| `trace/assistant_text` | `{ body, charCount, llmCallId, step }` |
| `trace/tool_use_update` | `{ toolName, toolUseId, charCount, input, llmCallId, step }` |
| `trace/tool_use` | `{ toolName, toolUseId, charCount, input }`（仅已提交 `ToolCall`） |
| `trace/tool_result` | `{ toolName, toolUseId, status, body, charCount }` |
| `context/metrics_pre` | `{ report }` without historical message details |
| `context/metrics_post` | `{ report }` without historical message details |
| `context/context_compact` | compact mode and token deltas |
| `tool_use_log/tool_use` | `{ toolName }` |

`tool_use` / `tool_use_update` 的 `charCount` 是 input 序列化为紧凑 JSON 后的 Unicode 标量字符数；`tool_result.charCount` 是持久化 `body` 的 Unicode 标量字符数。对于 `ToolContent::Json`，`body` 是紧凑 JSON 文本，因此 JSON string 的引号计入字符数。

`trace/tool_result.status` 使用 `ToolResultStatus` 的稳定 serde 表示：

```text
"succeeded"
{ "failed": { "retryable": boolean } }
"invalid_arguments"
"unknown_tool"
"denied"
{ "cancelled": { "reason": "user" | "parent" | "hook" | "disposed" } }
"outcome_unknown"
```

## Retention and recovery

- Keep at most 20 completed runs and at most 20 MiB of compressed segments.
- When either limit is exceeded, delete every segment belonging to the oldest
  completed run until both limits are satisfied.
- Active, `.sealed`, `.tmp`, and legacy log files are excluded from retention.
- Startup removes stale `.tmp` files, retries `.sealed` compression, and seals
  abandoned active files.
- Existing `.moontide/events.jsonl`, `context.jsonl`, and
  `.moontide-audit.log` files are left untouched and are no longer read or
  appended.

## Status sidecar

`workdir/.moontide/status.json` includes the active `runId`:

```json
{
  "phase": "running",
  "model": "deepseek-v4-pro",
  "workdir": "~/code/...",
  "runId": "4d621728-500d-4db7-89ac-ff5a8e24c44b",
  "turn": 2,
  "contextPct": 12.3
}
```

The Rust sidecar switches active files when `runId` changes, preserves in-memory
rows across segment rotation, and intentionally ignores `.jsonl.gz` archives.
