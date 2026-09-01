# MoonTide Desktop — Integrated Runtime

> **Status:** current (2026-09-02)
> **Supersedes:** independent `crates/desktop` Host crate, in-process `DesktopProtocolClient → Transport → DesktopProtocolServer` chain, D4 agent-host process split (see archived docs).

## Architecture

```text
Svelte WebView
  → typed Tauri invoke (list_sessions, start_session, load_session_history, new_chat, …)
  → DesktopRuntimeCoordinator (runtime replacement, catalog read)
  → DesktopRuntimeHandle (lifecycle facade, not an actor)
  → DesktopHostHandle (single mailbox)
  → DesktopHost actor (Agent, Session, Turn, approval)
  → ordered event pump → desktop-envelope → RenderState
```

Host facts (Agent, Session Item Log authority, Turn lifecycle, approval) remain owned exclusively by `DesktopHost`. `DesktopRuntime` coordinates one connection epoch, session start, shutdown, and event adaptation. `DesktopRuntimeCoordinator` owns replacement of that in-process runtime; replacement never deletes a Session Item Log.

## Desktop storage ownership

Desktop storage is resolved from Tauri's application configuration directory and never from the
process working directory:

```text
app_config_dir()/
  settings.json

app_data_dir()/
  content/
    sessions/
    runs/
```

`settings.json` version 3 stores the explicit absolute `project_root`, provider, model, and base
URL. The Agent uses `project_root` as its workspace `cwd`; the application content directory owns
only Session Item Logs and Agent Event Logs. Provider credentials remain environment-owned and are
not persisted in Desktop JSON. Inherited process environment values take precedence over the
optional `project_root/.env` development fallback; dotenv discovery never uses the process working
directory and a malformed explicit dotenv file fails startup.

The Tauri shell resolves `app_config_dir()` and `app_data_dir()` before constructing the first
runtime generation and passes the resulting storage layout into `bootstrap`. Development and
packaged builds use the same rules for their configured bundle identifier; a production identifier
must be selected before release data exists. Legacy project-local `.moontide` data is not scanned,
merged, moved, or deleted automatically; any development migration is an explicit copy operation.

## Decision: Session lifecycle (Option A)

Single **generation** = one `DesktopRuntime` boot, one consumed `AgentConfig`, one optional Host, one loaded Session at a time. Session switch requires shutdown, new generation, new `connection_epoch`.

The active path exposes catalog, one-shot Session start, and runtime replacement. Controller intents compose those typed operations; components never create or replace a runtime.

| Principle | Rule |
|-----------|------|
| Loaded identity | At most one loaded Session per runtime |
| Catalog | `list_sessions` reads Session storage; does not require a running Host |
| First send | Deferred to Batch 3 as a Controller-owned `create_session → submit_turn { session_id, text }` transaction |
| Switch / New Chat | `new_chat` closes and replaces the runtime; Controller `loadSession(id)` then uses `start_session { session_id }` |
| Failure | Partial failures return explicit `rejected` codes; UI does not infer success from timeouts |

Future **Option B** (Runtime reusable after shutdown without full recreate) is deferred until switch cost or concurrency needs are measured. **Option C** (Host hot switch) is out of MVP scope.

## Typed invoke boundary

### Session lifecycle (Chat primary)

| Tauri command | Preconditions | Action | Reply |
|---------------|---------------|--------|-------|
| `list_sessions` | runtime available | read Session catalog from storage | `session_catalog_listed { connection_epoch, rows }` or `rejected` |
| `new_chat` | close gate pass if Host running | shutdown current generation if needed → create fresh Ready generation (no loaded Session) | `generation_ready { connection_epoch }` or `rejected` |
| `create_session` | Ready runtime with no loaded Session | create exactly one canonical Session | `session_ready { connection_epoch, snapshot }` or `rejected` |
| `start_session { session_id }` | Ready runtime with no loaded Session | load exactly one existing Session | `session_ready { connection_epoch, snapshot }` or `rejected` |
| `load_session_history { session_id, before_turn, limit }` | matching loaded Session; settled Turn/delivery state; `limit` in `1..=100` | read whole Turns strictly before `before_turn` without changing Host identity | `session_history_page { session_id, items, oldest_turn, has_older }` or `rejected` |

Controller `loadSession(id)` uses the current Ready runtime from Blank. From Loaded it first waits for `new_chat`, then invokes `start_session { session_id }`. Close gates are derived from authoritative run, approval, and delivery state before the intent is sent.

### Turn and Host (loaded Session)

| Tauri command | Action | Reply |
|---------------|--------|-------|
| `submit_turn { session_id, text }` | continue the loaded Session only when its identity matches `session_id` | `turn_accepted { turn }` or `rejected` |
| `cancel_turn` | cancel active turn | `cancellation_accepted { turn }` or `rejected` |
| `approve` / `deny` | resolve approval | `approval_accepted { approval_id }` or `rejected` |
| `snapshot` | authoritative resync baseline | `snapshot { snapshot }` or `rejected` |

Terminal Turn outcome still arrives only through events after acceptance.

`session_ready` and `snapshot` carry only the latest 30 whole Turns plus
`history { oldest_turn, has_older }`. The Session Item Log remains the full canonical history;
`before_turn` is an exclusive cursor, not a page number or item offset.

### Generation teardown

| Tauri command | Action | Reply |
|---------------|--------|-------|
| `shutdown` | graceful Host shutdown (window close, internal) | `shutdown_completed { report }` or `rejected` |

### Wire semantics

- Tauri correlates invoke ↔ result; **no** `request_id`, command envelope, or Handshake on the active path.
- `Result<DesktopResponse, BridgeError>` distinguishes **not enqueued** / transport failure (`BridgeError`) from **domain rejection** (`Ok(rejected { … })`).
- Successful mailbox enqueue means the Host accepted responsibility.

### Rejection codes (Session additions)

| Code | Meaning |
|------|---------|
| `shutdown_failed` | old runtime could not confirm a clean stop; keep the last Loaded projection as evidence and require explicit runtime retry |
| `generation_not_ready` | old runtime stopped but fresh runtime construction failed; remain Blank |
| `catalog_unavailable` | Session store read failed |
| `session_start_failed` | create/resume failed and consumed the one-shot runtime; remain Blank |
| `session_mismatch` | submitted Session ID differs from the loaded Session; do not send or switch |
| `history_unavailable` | the loaded Session history page could not be read; preserve the current delivered window and allow retry |

Existing codes (`session_not_started`, `session_already_started`, `stopped`, …) unchanged.

## Event seam (unchanged semantics)

Events still use `DesktopMessageEnvelope` on `desktop-envelope`:

- monotonic `connection_epoch` (assigned at generation start) and per-session `seq`
- listener-first boot: subscribe before first Session command
- snapshot baseline + buffered replay + gap detection + resync
- `desktop-connection` for degraded shutdown / stream closure

Wire DTOs live in `src-tauri/src/protocol/` (Serde only, no Agent/Tauri deps). Host → wire conversion is `runtime/adapter.rs`.

## Module ownership

| Module | Owner |
|--------|--------|
| `bootstrap.rs` | `AgentConfig` composition root (settings + env) |
| `runtime.rs` | `DesktopRuntime`, epoch, session/shutdown orchestration |
| `runtime/host/` | Host actor, mailbox, Turn execution |
| `runtime/event/` | `EventBuffer`, ordered delivery |
| `runtime/approval/` | `ApprovalBroker` |
| `runtime/state/` | canonical run state + snapshot |
| `protocol/` | cross-WebView DTOs + conformance tests |
| `shell.rs` | window lifecycle, generation coordinator, Tauri adapters, event pump, catalog read |

Internal items are `pub(crate)`; raw Tokio senders and Agent ownership do not leak past `runtime/`.

## Implementation batches

| Batch | Scope | Status |
|-------|--------|--------|
| **1 Contract** | `protocol/` DTOs, `DESIGN.md`, Rust/TS conformance tests | complete |
| **2 Runtime/shell** | `list_sessions`, `new_chat`, existing-only `start_session`, required `submit_turn.session_id`; generation coordinator and Controller intents | completed |
| **3 Projection/first send** | `create_session`; single-flight create → submit transaction; first-send state; UI model derivation | completed |
| **4 Shell/sidebar/Blank** | thin App shell, Session sidebar, Blank Conversation, first-send UI gate, White/Black foundation | completed |
| **5 Loaded Conversation** | reading column, typed message blocks, in-place streaming, inline tool/approval/notice, sticky Composer, docked resizable Session drawer | completed |
| **6 Interaction/QA** | keyboard, IME, focus, accessibility, responsive and real-window visual validation | pending |
| **7 Session performance/history** | streaming catalog projection, one post-switch catalog refresh, bounded initial history, explicit older-Turn paging | implemented; reviewed |

UI contract details: [`docs/UI-STATE.md`](docs/UI-STATE.md), [`docs/UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`](docs/UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md).

## Non-goals (MVP)

- Cross-process agent-host, `desktop-supervisor`, daemon, multi-agent
- Generic `desktop_request` invoke or compatibility re-exports
- Host hot switch (Option C) or concurrent loaded Sessions
- multi-window, background Session, scheduler

## Verification

```bash
cargo test -p moontide-desktop
cargo clippy -p moontide-desktop --all-targets -- -D warnings
cd crates/moontide-desktop/frontend && pnpm test && pnpm run check && pnpm run build
```
