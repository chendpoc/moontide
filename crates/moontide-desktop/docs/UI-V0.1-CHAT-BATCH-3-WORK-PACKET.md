# Work Packet: Desktop Chat / Batch 3

- **Base:** `feat/desktop-ui` at `28e062f`; Batch 2 and the surrounding Desktop refactor remain uncommitted parallel work accepted for takeover.
- **Mode:** Implementation.
- **Version goal:** v0.1 pre-release contract; Rust and TypeScript may change together without a compatibility layer.
- **Goal:** make Blank first Send create one canonical Session and submit the exact draft to that returned Session identity, while deriving Chat and Session-list UI facts without moving ownership into Svelte.
- **Source of truth:** `DESIGN.md`, `UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`, `UI-STATE.md`, `UI-INTERACTION.md`, Batch 2 Work Packet, current source and tests.
- **Confirmed decisions:** first Send is the Controller-owned `create_session → submit_turn { session_id, text }` transaction; `create_session` and `start_session` are separate public commands; `start_session` loads an existing Session only; `submit_turn` never creates, loads, or switches a Session.
- **Ownership:** Host and SessionStore create and persist the Session; the runtime coordinator owns the current generation; Controller owns command sequencing and its single-flight guard; Svelte owns the editable draft; pure projection functions derive page/list/composer views.
- **Scope:** explicit Rust/TypeScript `create_session` contract, typed Tauri permission/bridge, Controller first-send state and sequencing, `chatUiModel`/`sessionListModel` derivation, focused protocol/runtime/Controller/projection/App tests, and contract documentation corrections discovered during implementation.
- **Non-goals:** Sidebar or full Blank/Loaded page components, visual theme implementation, persisted Session title, attachments, queued prompts, background/concurrent Sessions, retry idempotency protocol, database/migration, process boundary, multi-Agent.
- **Risks:** the one-shot runtime is consumed even when Session creation fails; create success followed by submit rejection leaves an empty loaded Session; a late acceptance must not clear user text typed after the submitted draft; stale catalog or event epochs must not change the returned Session identity.

## Tasks

| Task | Deliverable | Acceptance |
|---|---|---|
| B3-1 Contract | `create_session`; existing-only `start_session`; Rust/TS schema and bridge parity | round-trip and bridge tests prove exact command names/arguments; no second new-Session public path |
| B3-2 Runtime | coordinator/runtime create and load entry points over the existing private one-shot start seam | create returns canonical `SessionReady`; load identity remains validated; failed creation does not fabricate Blank readiness |
| B3-3 Controller | first-send state `idle → creating_session → submitting_first_turn → idle` and single-flight sequencing | exact draft and returned Session ID are each used once; create failure stays Blank; submit rejection stays Loaded; duplicate activation cannot issue another command |
| B3-4 Projection | pure `chatUiModel` and `sessionListModel` | page identity depends only on loaded Session identity; message count cannot change it; exactly one catalog row is selected from Host facts |
| B3-5 Integration | Blank composer authority and acceptance-safe draft clearing at the existing App seam | ready Blank can submit; acceptance only clears the exact still-current draft; new user edits survive |
| B3-6 Validation | focused checks, workspace `just check`, independent Standards/Spec review | all results recorded; no Blocker/Warning remains without explicit user decision |

- **Reviewer:** independent Tidewatch after implementation.
- **User parallel task:** trace `Blank → create_session → SessionReady(id) → submit_turn(id, text) → TurnAccepted`; write down who owns the draft, Session identity, and Session Item Log at each step. Do not modify Desktop files during this batch.
- **Shared acceptance:** create failure preserves Blank/exact draft; submit rejection preserves Loaded/exact draft; create and submit each execute once per intent; existing Session continuation still requires the loaded ID; Blank/Loaded ignores message count; snapshot replacement does not overwrite frontend-local draft/theme; focused Rust/frontend checks and `just check` pass.
- **Stop conditions:** any need for implicit Session switching, deletion/migration, concurrent runtime generations, server-side combined create-and-submit, public persistence changes, or frontend ownership of canonical Session facts returns to architecture alignment.

## Outcome

- Rust Desktop: 32 tests passed.
- Frontend: Svelte check passed; 63 tests passed; production build passed.
- Workspace: `RUSTC=/Users/chenjiayu/.cargo/bin/rustc just check` passed outside the port-restricted sandbox.
- Independent Tidewatch Standards/Spec review: PASS after lifecycle-gate, resync-order, stale-event, and App phase fixes.
- Architecture follow-up closed by user decision: keep `desktopController.ts` as the single owner of its coupled asynchronous state machine. Its size is an accepted soft-limit exception; reconsider extraction only when a concrete independent state boundary, second consumer, or recurring merge conflict appears.
- Git: no commit created.
