# Work Packet: Desktop Chat / Batch 4

- **Base:** `feat/desktop-ui` at `28e062f`; Batch 1-3 and the surrounding Desktop refactor remain uncommitted work accepted for continuation.
- **Mode:** Implementation.
- **Version goal:** v0.1 Shell, Session sidebar, and Blank Conversation over the completed typed Controller contract.
- **Goal:** replace the technical vertical-slice layout with a thin App shell and a usable Chat feature that can start a new conversation or open an existing Session without moving runtime ownership into Svelte.
- **Current hypothesis:** the existing Controller port, catalog projection, first-send transaction, theme hook, and shadcn Sidebar primitives are sufficient; Batch 4 should require no Rust, protocol, bridge, or Controller changes.
- **Source of truth:** `DESIGN.md`, `UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`, `UI-STATE.md`, `UI-INTERACTION.md`, `UI-VISUAL-DIRECTION.md`, frontend `README.md`, Batch 3 Work Packet, current source and tests.
- **Confirmed decisions:** `desktopController.ts` remains the single owner of its coupled asynchronous state machine; Svelte owns only editable draft, local command phase, theme preference, layout, and user intent; components call `DesktopControllerPort`, never bridge or protocol APIs.
- **Ownership:** Host owns Session facts and runtime lifecycle; Controller owns sequencing, loaded identity, catalog and delivery projection; `ChatShell` subscribes to the Controller and routes typed intent; child components render props and emit UI intent.
- **Scope:** documentation alignment; thin `app/App.svelte`; `lib/features/chat/` Shell, Session sidebar, Top Bar, Blank Conversation and shared Composer; White/Black theme control; focused component/App tests; responsive and keyboard evidence.
- **Non-goals:** Controller refactor; Rust/protocol/bridge changes; redesigning Loaded Conversation content; new message actions; queued prompts; persisted titles; Terminal, File tree, Agent Dock, tabs, split panes, multi-Agent or concurrent Sessions; Batch 5/6 visual and accessibility completion.
- **Risks:** extracting the current App can accidentally change its Loaded behavior; sidebar selection can be mistaken for canonical loaded state; narrow-screen overlay may lose focus; first-send acceptance can clear newer user text; catalog failure must not be presented as an empty history.

## Tasks

| Task | Deliverable | Acceptance |
|---|---|---|
| B4-1 Documentation | Batch 3 follow-up closure, frontend size exception, detailed Batch 4-6 status | documents agree that Controller is not a Batch 4 refactor target |
| B4-2 Feature shell | thin `app/App.svelte` and `features/chat/ChatShell.svelte` composition | App only injects/subscribes/disposes; feature code depends on Controller Port, not bridge/protocol |
| B4-3 Session sidebar | real catalog states, selected loaded row, New Chat and load intents | listing/ready/empty/failed are distinct; selection comes only from Host-backed `loaded`; one lifecycle intent can run at a time |
| B4-4 Blank and Composer | Blank hierarchy, shared draft, first-send gate and action error | exact draft survives failure and newer edits survive acceptance; no fake Session is created in the component |
| B4-5 Theme and responsive shell | White/Black control and desktop/overlay sidebar behavior | theme changes geometry neither at `1440x900` nor `960x720`; overlay closes by keyboard and restores trigger focus |
| B4-6 Validation | focused frontend checks, build, workspace check, responsive evidence and independent review | results and remaining Batch 5/6 work are recorded; no unresolved P0/P1/P2 finding remains |

- **Agent task:** implement B4-1 through B4-6 without modifying Controller, bridge, protocol, or Rust behavior.
- **Reviewer:** independent Tidewatch after implementation.
- **User parallel task:** review the finished Blank and sidebar states at `1440x900` and `960x720`; confirm that New Chat, the selected historical Session, theme control, and the single primary Blank action are understandable without reading implementation details.
- **Shared acceptance:** Session facts come only from Controller state; components issue only Controller intents; first-send failure preserves the exact draft; catalog error is distinct from empty; existing Loaded behavior remains available but gains no Batch 5 feature; White/Black and overlay keyboard behavior pass focused tests and manual viewport checks; frontend checks/build and final `just check` pass or have an explicit environment blocker.
- **Evidence:** Batch 3 frontend check, 63 tests, build, workspace `just check`, and independent review passed before this batch; current App is a 367-line technical vertical slice; shadcn Sidebar and theme hook already exist.
- **Open questions:** none that change the Batch 4 contract. Exact spacing and typography remain implementation details constrained by the accepted visual direction.
- **Next smallest experiment:** render the existing Controller fixture through a thin Chat shell with one real Session row and a Blank first-send state before adding responsive polish.
- **Stop conditions:** any need to change Controller/Rust/protocol ownership, fabricate Session facts, add unsupported product actions, redesign Loaded Conversation behavior, or expand v0.1 navigation returns to architecture alignment.

## Outcome

- Implemented a 27-line App composition root plus `features/chat/` Shell, Sidebar, Top Bar,
  Blank Conversation, behavior-preserving Loaded extraction, and shared Composer. No Controller,
  bridge, protocol, Tauri, or Rust behavior changed.
- Added explicit catalog refresh evidence and command-phase convergence. A successful submit remains
  locally pending until authoritative Turn state advances; a successful cancel remains pending until
  the authoritative run leaves its active states. Session transitions are gated during both phases.
- Frontend evidence: `pnpm run check` passed with 0 diagnostics; `pnpm test -- --run` passed 70 tests;
  `pnpm run build` passed with 856 modules transformed.
- Workspace evidence: `/Users/chenjiayu/.cargo/bin/rustc 1.97.1`; `just check` passed after rerunning
  outside the filesystem sandbox because wiremock localhost binding is denied inside it. Desktop Rust
  tests passed 32/32; all workspace tests, clippy, and formatting passed.
- Responsive evidence: ordinary-browser inspection passed at `1440x900` in White/Black and at
  `960x720`; the overlay closed with Escape and restored opener focus. This is layout evidence only:
  the ordinary browser has no Tauri runtime, so real-window Session switching remains Batch 6 QA.
- Independent Tidewatch first pass found command-phase convergence, retained-list refresh visibility,
  Loaded scope, tests, and document drift; all findings were addressed. Final Standards / Spec
  re-review passed with no remaining P0/P1/P2 findings.
- Git: no commit requested.
