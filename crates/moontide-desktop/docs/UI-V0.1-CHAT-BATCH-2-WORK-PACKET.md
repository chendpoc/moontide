# Work Packet: Desktop Chat / Batch 2

- **Base:** `feat/desktop-ui` at `28e062f`; Desktop refactor and frontend baseline are uncommitted parallel work accepted for takeover.
- **Mode:** Implementation.
- **Goal:** provide a real Session catalog and safe serial Session switching for v0.1.
- **Source of truth:** `README.md`, `DESIGN.md`, `UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`, `UI-INTERACTION.md`, current source and tests.
- **Confirmed decisions:** one window has at most one loaded Session; closing never deletes its Session Item Log; a fresh in-process runtime is Ready when construction succeeds; no Handshake is added; `submit_turn` requires the loaded `session_id` and never loads or switches Session.
- **Scope:** Desktop protocol DTOs, runtime coordinator/catalog query, typed Tauri bridge, frontend Controller projection/intents, focused tests and contract docs.
- **Non-goals:** `create_session` and the first-send Controller transaction, Session sidebar/components, persisted titles, background Sessions, multi-Agent, new persistence fields.
- **Agent task:** implement `list_sessions`; implement `new_chat` as shutdown/discard/recreate; require and validate `session_id` on `submit_turn`; implement Controller `newChat`, `loadSession`, `retryRuntime`, and `retryCatalog`; synchronize Rust/TypeScript schemas and tests.
- **Reviewer:** independent Tidewatch after implementation.
- **User parallel task:** trace `Loaded → newChat → Blank → loadSession(id) → Loaded`; identify which step owns the Agent, Session Item Log, and draft. Do not modify Desktop files during this batch.
- **Shared acceptance:** ready/empty/catalog failure/load failure, unique loaded identity, resync, `Loaded → Blank → Loaded`, shutdown failure, fresh-runtime failure, and wrong-Session submit rejection are reproducible; focused Rust and Controller tests pass; `just check` result is recorded.
- **Stop conditions:** any need to delete/migrate Session data, add a process boundary, support concurrent Sessions, or change Agent/Session ownership returns to architecture alignment.
