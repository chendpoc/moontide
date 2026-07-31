# Agent Event Log（AgentEvent storage schema）

Oculeau 将单次 run 的观测 JSONL 称为 **Agent Event Log**（与 **Session Event Log** 区分；后者见 [`context-composer.md`](context-composer.md)）。

## Agent Event Log vs Session Event Log

| | Agent Event Log | Session Event Log |
|---|-----------------|-------------------|
| Scope | 单次 run | 整场 session |
| Path | `.oculeau/runs/<runId>.active.jsonl` | `.oculeau/sessions/<sessionId>.jsonl` |
| 职责 | trace、metrics、audit、UI tail | 会话事实 source of truth |
| Schema | 本文 + `src/events/types.ts` | [`context-composer.md` §5](context-composer.md#5-session-event-log--条目-spec) |

---

Oculeau writes one JSON object per line for the active run:

```text
workdir/.oculeau/runs/<runId>.active.jsonl
```

Before an append would push the active file above 5 MiB, the complete existing
lines are sealed and compressed with gzip level 2:

```text
workdir/.oculeau/runs/<runId>-0001.jsonl.gz
```

The final active segment is also compressed when the run completes. Compressed
segments are lossless archives; the desktop UI only tails the active JSONL.

TypeScript source: [`src/events/types.ts`](../src/events/types.ts).

## Core fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event UUID |
| `seq` | number | Monotonic sequence within a run |
| `runId` | string | Run identifier and storage routing key |
| `turn` | number | Agent loop turn |
| `phase` | string | `pre_llm` \| `post_llm` \| `post_tool` \| `stop` |
| `channel` | string | `conversation` \| `trace` \| `context` \| `audit` |
| `kind` | string | Event kind |
| `ts` | number | Unix milliseconds |
| `payload` | object | Kind-specific persisted payload |
| `preview` | string? | Short UI/grep summary |
| `truncated` | boolean? | True when the persisted event exceeded 64 KiB |
| `originalBytes` | number? | Serialized size before truncation |

Persisted events also include `summary` and `displayHint`.

## Persistence projection

- A persisted JSONL line is at most 64 KiB.
- Context reports omit `messageLines`, messages, system prompts, and tool
  schemas. They retain aggregate token, usage, structure, trend, and alert data.
- A trace `tool_use` stores structured `input` once; its duplicate JSON body is
  omitted.
- Audit events store the tool name without duplicating tool input or output.
- Runtime `AgentEvent` objects remain unchanged; projection happens only at the
  storage boundary.

## Channel payloads

| Channel/kind | Persisted payload |
|--------------|-------------------|
| `conversation/user_prompt` | `{ text }` |
| `conversation/final` | `{ text }` |
| `trace/thinking` | `{ body, charCount }` |
| `trace/assistant_text` | `{ body, charCount }` |
| `trace/tool_use` | `{ toolName, toolUseId, charCount, input }` |
| `trace/tool_result` | `{ toolName, toolUseId, body, charCount }` |
| `context/metrics_pre` | `{ report }` without historical message details |
| `context/metrics_post` | `{ report }` without historical message details |
| `context/context_compact` | compact mode and token deltas |
| `audit/tool_use` | `{ toolName }` |

## Retention and recovery

- Keep at most 20 completed runs and at most 20 MiB of compressed segments.
- When either limit is exceeded, delete every segment belonging to the oldest
  completed run until both limits are satisfied.
- Active, `.sealed`, `.tmp`, and legacy log files are excluded from retention.
- Startup removes stale `.tmp` files, retries `.sealed` compression, and seals
  abandoned active files.
- Existing `.oculeau/events.jsonl`, `context.jsonl`, and
  `.oculeau-audit.log` files are left untouched and are no longer read or
  appended.

## Status sidecar

`workdir/.oculeau/status.json` includes the active `runId`:

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
