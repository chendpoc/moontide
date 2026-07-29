# AgentEvent schema (UI consumers)

Oculeau appends one JSON object per line to `workdir/.oculeau/events.jsonl`.  
TypeScript source: [`src/events/types.ts`](../src/events/types.ts).

## Core fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID |
| `seq` | number | Monotonic sequence within run |
| `runId` | string | Session run id |
| `turn` | number | Agent turn |
| `phase` | string | `pre_llm` \| `post_llm` \| `post_tool` \| `stop` |
| `channel` | string | `conversation` \| `trace` \| `context` \| `audit` |
| `kind` | string | See tables below |
| `ts` | number | Unix ms timestamp |
| `payload` | object | Kind-specific body |
| `preview` | string? | Short summary for grep / UI |

Enriched fields (JSONL only): `summary`, `displayHint` — see [`enrich.ts`](../src/events/enrich.ts).

## Status sidecar

`workdir/.oculeau/status.json` mirrors [`StatusSnapshot`](../src/cli/statusline/types.ts):

```json
{
  "phase": "idle",
  "model": "deepseek-v4-pro",
  "workdir": "~/code/...",
  "turn": 2,
  "contextPct": 12.3
}
```

## Channel → kind

### conversation

| kind | payload |
|------|---------|
| `user_prompt` | `{ text }` |
| `final` | `{ text }` |

### trace

| kind | payload |
|------|---------|
| `thinking` | `{ body, charCount }` |
| `tool_use` | `{ toolName, toolUseId, body, input }` |
| `tool_result` | `{ toolName, toolUseId, body, charCount }` |
| `assistant_text` | `{ body, charCount }` |

### context

| kind | payload |
|------|---------|
| `metrics_pre` | `{ report: ContextReport }` |
| `metrics_post` | `{ report: ContextReport }` |
| `context_compact` | `{ mode, beforeTokens, afterTokens }` |

### audit

| kind | payload |
|------|---------|
| `tool_use` | `{ toolName, toolInput }` |

## UI mapping (oculeau-ui)

| Tab | Filter |
|-----|--------|
| Trace | `channel == trace` |
| Chat | `channel == conversation`, kinds `user_prompt` / `final` |
| Context | `channel == context` |

Terminal formatters for reference: [`src/events/format/`](../src/events/format/).
