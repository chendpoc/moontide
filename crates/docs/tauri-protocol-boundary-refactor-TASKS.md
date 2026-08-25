# Tauri Protocol Boundary Refactor Tasks

> **Feature document:** [`tauri-protocol-boundary-refactor.md`](tauri-protocol-boundary-refactor.md)
> **Version goal:** D3-PF
> **Status:** R1 committed as `2cdf850`; R2 committed as `19b36d7`; R3 committed as `9a8320e`;
> R4 committed as `500c183`; R5 committed as `375731e`; R6 complete and commit authorized

## Review batches

| Review batch | Feature tasks | Theme | Estimated diff | Status |
|---|---|---|---:|---|
| R1 | 01–03 | Protocol v1 evidence and validation rules | ~700 | Committed (`2cdf850`) |
| R2 | 04–08 | Host-side protocol adapter | ~1,300 | Committed (`19b36d7`) |
| R3 | 09–13 | Protocol client, in-process transport and Tauri bridge | ~1,600 | Committed (`9a8320e`) |
| R4 | 14–17 | TypeScript contract, RenderState and resync orchestration | ~1,800 | Committed (`500c183`) |
| R5 | 18–19 | Minimal Svelte UI and security baseline | ~1,400 | Committed (`375731e`) |
| R6 | 20–24 | Transitional deletion, dependency cleanup and final evidence | ~1,500 | Complete; Tidewatch passed |

## Work Packet: D3-PF / R0 (Review Batch R1)

- **Base:** `feat/assistant-host/r2` at `614ab7f`; existing Desktop/Tauri changes are dirty and preserved.
- **Mode:** Implementation.
- **Goal:** Freeze protocol v1 JSON evidence and identity validation before changing runtime routing.
- **Task document:** `crates/docs/tauri-protocol-boundary-refactor.md`.
- **Source of truth:** `AGENTS.md`, the feature document, `desktop-protocol` README/DESIGN,
  current DTO source and tests.
- **Confirmed decisions:** `desktop-protocol` is the only wire graph; command correlation and event
  delivery identity remain separate; this batch does not change the JSON shape.
- **Open questions:** None for R1. A required wire-shape change is a stop condition.
- **Evidence:** Current DTOs cover eight commands, eight responses and fourteen semantic events;
  existing tests only exercise one command, one event and the frame limit.
- **Scope:** `crates/desktop-protocol/**`, this TASKS file and the feature document status/evidence.
- **Non-goals:** Host adapter, Tauri wiring, frontend package setup, process transport, settings.
- **Agent Task:** Complete TASK-01 through TASK-03 with focused tests.
- **Reviewer:** Tidewatch in an independent context after implementation evidence is ready.
- **User Parallel Task:** Trace `request_id`, `connection_epoch` and `seq` ownership from the
  protocol docs; do not modify `crates/desktop-protocol/**`.
- **Shared Acceptance:** All top-level variants have committed fixtures; identity rules are
  executable; JSON shape remains v1; `cargo test -p desktop-protocol` passes.
- **Decision changes:** None.
- **Next smallest experiment:** Deserialize the complete fixture bundle as public protocol DTOs.
- **Stop conditions:** Any required protocol-version bump, DTO field change, Agent ownership change
  or overlap with unrelated dirty files.

### R1 Implementation Evidence

- **Changed files:** three protocol fixture files, one integration test, protocol DESIGN validation
  rules and this task-control document.
- **Diff size:** 1,044 directly attributable inserted/changed lines: fixtures 489, integration test
  232, protocol DESIGN 21 and task-control document 302; the already-untracked feature document
  also has two R1 status/link line changes that Git cannot separate from its pre-R1 contents.
- **Focused validation:** `cargo test -p desktop-protocol` passed (6 tests).
- **Workspace validation:** `just check` passed after rerunning outside the filesystem/network
  sandbox so eight existing wiremock tests could bind loopback ports. The initial sandboxed run
  failed only with `PermissionDenied` while binding those mock-server ports.
- **Contract result:** all eight commands, eight responses and fourteen events have deterministic
  committed JSON fixtures; command request IDs are unique, response IDs form the same one-to-one
  set, and event seq is checked within one asserted connection epoch.
- **Documentation:** protocol validation/failure rules are synchronized; no DTO field, enum or
  protocol version changed.
- **Known risk:** nested Rust enum encoding remains the actual v1 JSON shape and is now explicit in
  fixtures; TypeScript must conform to these fixtures rather than the old plain-JavaScript guesses.
- **Unverified:** real WebView consumption is intentionally deferred to R4/R5.
- **Tidewatch:** independent Standards/Spec re-review passed with no findings after correlation,
  epoch, evidence-count and Work Packet naming corrections.
- **Commit:** `2cdf850 feat(desktop-protocol): freeze v1 wire contract`.

## Work Packet: D3-PF / R1 (Review Batch R2)

- **Base:** `feat/assistant-host/r2` at `2cdf850`; the pre-existing Desktop/Tauri tracer-bullet
  work remains dirty and must be preserved.
- **Mode:** Implementation; public seam confirmed by the user on 2026-08-25.
- **Goal:** Make one Host-side adapter the only active command/response/event boundary between
  `desktop-protocol` envelopes and the D1 `DesktopHost` actor.
- **Task document:** `crates/docs/tauri-protocol-boundary-refactor.md`.
- **Source of truth:** `AGENTS.md`, the feature document, `desktop-protocol` v1 fixtures, the current
  D1 Host contract and current lifecycle tests.
- **Confirmed decisions:** the adapter does not depend on Tauri; it owns protocol connection state
  but not a second Agent; valid domain rejection stays inside a correlated wire response; the
  Session Item Log remains recovery truth.
- **Confirmed public seam:** `DesktopProtocolServer::start(DesktopProtocolConfig)` returns a cloneable
  `DesktopProtocolServerHandle` plus `DesktopProtocolEventStream`; `request` accepts and returns
  independent `desktop_protocol::DesktopMessageEnvelope` values; events are emitted in the same
  independent envelope graph.
- **Confirmed lifecycle:** `Unhandshaken → Ready → Running → Stopped`. The server allocates the
  connection epoch on handshake. The first `StartSession` consumes the one-shot `AgentConfig` and
  starts exactly one D1 Host. A failed start returns a correlated `Internal` rejection and closes
  the server; it is not silently retried with another Agent.
- **Confirmed cancellation seam:** keep the current public `DesktopHostHandle::cancel_turn() ->
  Result<(), _>` contract. The actor returns the accepted turn identity through a crate-private
  method so the adapter can emit `CancellationAccepted { turn }` without a snapshot race.
- **Open questions:** None. The public seam and one-shot failed-start behavior are confirmed.
- **Scope:** `crates/desktop/src/host_protocol/**`, minimal Host actor support, direct wire event
  conversion, public exports, focused tests and synchronized Desktop design documentation.
- **Non-goals:** Tauri command wiring, protocol client, frontend types, process transport, settings,
  wire-shape changes, multiple simultaneous connections or retrying a failed Host boot in place.
- **Agent Task:** Complete TASK-04 through TASK-08 after confirmation, then produce focused and
  workspace verification evidence.
- **Reviewer:** Tidewatch in an independent context after implementation evidence is ready.
- **User Parallel Task:** Trace the owner of `AgentConfig`, `connection_epoch`, active Turn identity
  and shutdown state through the proposed lifecycle table; do not modify `crates/desktop/**`.
- **Shared Acceptance:** all eight v1 commands are routed or rejected deterministically; every
  response preserves its command request ID; events use one epoch and strictly increasing buffer
  seq; no Tauri dependency enters `desktop`; `cargo test -p desktop` and `just check` pass.
- **Decision changes:** adds a public in-process protocol-server seam but does not change v1 JSON or
  the D1 Host public signatures.
- **Next smallest experiment:** prove handshake identity and pre-session rejection using the R1
  fixtures against the proposed server handle.
- **Stop conditions:** wire-shape/version change, need for multiple Agent owners, retryable boot
  requiring a config factory, Tauri dependency in Host, or overlap that would overwrite unrelated
  dirty tracer-bullet work.

### R2 Implementation Evidence

- **Changed files:** new `host_protocol` server actor and tests; minimal Host cancellation reply
  identity support; public exports; direct `DesktopEventEnvelope → desktop-protocol` conversion;
  Desktop README/DESIGN and this control document. `wire.rs` and its production dependencies began
  as preserved untracked tracer-bullet work; R2 extends and adopts that mapper at the Host boundary.
- **Diff size:** approximately 1,800 attributable inserted/changed lines: 1,378 new server/test
  lines, about 138 direct-wire mapper/test lines and about 285 tracked Host/docs/Cargo lines. The
  full untracked `wire.rs` is 727 lines, of which 589 predated R2. Existing untracked Tauri files and
  root Tauri Cargo/Cargo.lock changes are not R2 work and remain unstaged.
- **Focused validation:** `cargo test -p desktop` passed 46 tests, including delayed provider and
  real pending-approval flows run with loopback permission.
- **Workspace validation:** `just check` passed: format check, workspace/all-target clippy and 319
  workspace tests. Loopback permission was provided for existing and new mock-server tests.
- **Contract result:** all eight v1 commands reach either their D1 Host operation or a deterministic
  lifecycle/domain rejection; response request IDs are preserved; handshake owns a nonzero epoch;
  Host events preserve EventBuffer seq and carry no request ID.
- **Lifecycle result:** boot is lazy and one-shot; new/resume preserve Session identity; failed boot
  closes the server; cancel response gets turn identity atomically from Host actor; Stopped is
  enqueued before ShutdownCompleted and both channels close afterward.
- **Documentation:** confirmed public signatures, state machine, validation order, repeated-handshake
  semantics and one-shot failure behavior are synchronized in Desktop README/DESIGN.
- **Backpressure result:** graceful shutdown waits at most two seconds for the bounded event
  forwarder to drain. A stalled receiver aborts the forwarder, closes the server and returns
  infrastructure failure instead of hanging or emitting `ShutdownCompleted`; R3 surfaces this as
  degraded close.
- **Unverified:** Tauri bridge and frontend do not consume this server yet; that is R3/R4 scope.
- **Tidewatch:** Independent Standards/Spec review passed with no open findings after the epoch
  allocation, bounded shutdown, unexpected event-stream closure and response-correlation evidence
  were corrected. Tauri/client/frontend/process framing remain explicit R3/R4 scope.
- **Commit:** `19b36d7 feat(desktop): add host protocol adapter`.

## Work Packet: D3-PF / R2 (Review Batch R3)

- **Base:** `feat/assistant-host/r2` at `19b36d7`; the existing untracked Tauri tracer and its root
  Cargo/Cargo.lock changes are adopted only where this batch replaces their direct Host path.
- **Mode:** Implementation; request-identity ownership confirmed by the user on 2026-08-25.
- **Goal:** Make the Tauri vertical slice protocol-first through one transport-neutral Rust client
  and an in-process envelope transport that D4 can replace without changing the shell contract.
- **Task document:** `crates/docs/tauri-protocol-boundary-refactor.md`.
- **Source of truth:** `AGENTS.md`, the feature document, R1 fixtures, the committed R2 Host protocol
  server, current Tauri tracer source and current Tauri capability files.
- **Confirmed decisions:** Web sends a typed `DesktopCommand` intent, never an envelope identity;
  Rust client allocates `request_id`, injects its negotiated epoch and returns the full response
  envelope. Transport moves complete envelopes over bounded channels and owns no domain decisions.
- **Confirmed client seam:** an internal cloneable client handle exposes
  `request(DesktopCommand) -> anyhow::Result<DesktopMessageEnvelope>` plus one event/connection
  stream. Its actor owns request allocation, pending correlation, handshake epoch and disconnect
  cleanup. The Tauri bridge has one business command accepting `DesktopCommand` and returning the
  complete response envelope.
- **Confirmed lifecycle:** frontend subscribes before requesting Handshake; Handshake establishes
  the epoch; StartSession establishes the initial snapshot baseline. Unknown responses, identity
  mismatch or transport close fail all pending requests and close the client connection. Domain
  rejection remains an `Ok` response envelope.
- **Open questions:** None. A required v1 shape or ownership change is a stop condition.
- **Scope:** Tauri pure-Rust client/transport/composition/shell modules and tests; replacement of the
  five direct handlers/capability entries; minimal plain-JavaScript call-seam rewiring; root/Tauri
  manifests required to make the already-present shell a buildable workspace member; synchronized
  feature/task evidence.
- **Non-goals:** Svelte/TypeScript migration, product RenderState parity, settings behavior changes,
  `ProcessSupervisor`, process framing, auto-reconnect, CSP/global-Tauri tightening or UI redesign.
- **Agent Task:** Complete TASK-09 through TASK-13, run focused Tauri/Desktop and workspace gates,
  and produce Implementation Evidence.
- **Reviewer:** Tidewatch in an independent context after implementation evidence is ready.
- **User Parallel Task:** Trace `DesktopCommand intent → client request ID/epoch → transport
  envelope → Host response/event → bridge` and verify that no frontend/Tauri shell path owns
  `DesktopHostHandle`, `AgentConfig` or Session facts.
- **Shared Acceptance:** one business bridge entry; unique correlated responses; event identity
  preserved; disconnect fails pending work; Tauri shell has no direct Host handle/config/session
  imports; graceful close attempts protocol Shutdown; `cargo test -p moontide-desktop` and
  `just check` pass.
- **Decision changes:** D9 is clarified: “typed command” means the protocol `DesktopCommand` value,
  not a client-constructed envelope. This resolves the earlier conflict with D2/D6 ownership.
- **Next smallest experiment:** drive two concurrent fake-transport requests and return responses in
  reverse order to prove pending correlation without exposing envelope identity to the caller.
- **Stop conditions:** v1 JSON/version change, frontend-owned request/epoch identity, new public
  shared client crate, Host handle in shell state, D4 process lifecycle, settings redesign or an
  unsafe overlap with unrelated dirty work.

### R3 Implementation Evidence

- **Changed files:** the existing Tauri tracer is adopted as a workspace member and split into
  protocol client, in-process transport, bootstrap and shell modules; the direct Host handlers are
  replaced by one `desktop_request` bridge; capability, frontend call seam, Desktop design docs,
  root manifests and this task-control document are synchronized.
- **Diff size:** the current Tauri shell contains 2,093 non-generated lines, including the
  pre-existing tracer that Git cannot separate from R3 because the directory was untracked.
  Locally generated Tauri schemas are excluded from version control. Tracked non-lock changes are
  limited to the ignore/workspace manifests plus synchronized design/evidence docs; `Cargo.lock`
  contains the mechanical Tauri dependency graph.
- **Focused validation:** `cargo test -p moontide-desktop` passed 12 tests and
  `cargo clippy -p moontide-desktop --all-targets -- -D warnings` passed. `node --check` passed for
  the transitional plain-JavaScript frontend.
- **Workspace validation:** `just check` passed: format, workspace/all-target clippy and 331 tests.
  Loopback permission was provided for wiremock-based provider tests.
- **Client result:** the Rust client alone allocates monotonic request IDs, injects the negotiated
  epoch, correlates reversed concurrent responses, validates response/event identity and fails all
  pending work on unknown responses or transport closure. Its pending map has an executable
  64-request bound. Domain `Rejected` responses remain correlated successful envelopes.
- **Transport result:** one bounded in-process envelope pump connects the client to the committed
  R2 server without domain decisions. It admits one server request at a time so the bounded channel
  remains authoritative and command order cannot race Shutdown. Its real-server test covers
  handshake, new Session snapshot, delayed Submit, Cancel, Shutdown, ordered `Stopped` delivery and
  graceful channel close.
- **Shell result:** Tauri stores only the client and close state; the frontend invokes only
  `desktop_request`; capabilities allow the single business bridge plus the listen/unlisten and
  close lifecycle primitives. Static checks find no `DesktopHostHandle`, `DesktopHost` or
  `SessionSelection` in the shell modules, and `AgentConfig` appears only in bootstrap/tests.
- **Close result:** window close is intercepted once, awaits protocol Shutdown for at most three
  seconds, treats only `ShutdownCompleted` as clean and emits bounded degraded evidence before
  destroying the window on timeout, rejection or transport failure.
- **Known risk:** the window lifecycle has deterministic unit coverage but no manual WebView smoke
  evidence in this batch. The third-party `block 0.1.6` future-incompatibility warning remains an
  upstream dependency warning, not a failed gate.
- **Deferred by scope:** TypeScript fixture conformance, product RenderState/resync behavior and a
  real WebView smoke are R4; Svelte, CSP, global-Tauri removal and DOM-safety cleanup are R5.
- **Tidewatch:** independent Standards/Spec review passed with no remaining findings after the
  initial unbounded in-flight/order finding was corrected using a 64-request client pending limit,
  single-flight in-process server admission and executable bound coverage.
- **Commit:** `9a8320e feat(desktop): route Tauri through protocol client`.

## Work Packet: D3-PF / R3 (Review Batch R4)

- **Base:** `feat/assistant-host/r2` at `9a8320e`; worktree clean at batch start.
- **Mode:** Implementation; no new public Rust or wire contract.
- **Goal:** Make TypeScript the future single owner of Desktop product projection by establishing a
  fixture-conformant v1 schema, a pure RenderState fold and bounded boot/resync orchestration before
  any Svelte UI migration.
- **Task document:** `crates/docs/tauri-protocol-boundary-refactor.md`.
- **Source of truth:** `desktop-protocol/src/lib.rs`, all three committed v1 fixture bundles, the
  nine Rust `render_state` behavior tests and the R3 one-command Tauri bridge.
- **Confirmed decisions:** npm is the frontend package manager because the repository has no
  existing frontend manager and the local Node/npm toolchain is available; its lockfile is
  committed. One runtime TypeScript schema graph is the validation/type source and parses the Rust
  fixtures; the recursive ContentBlock algebra is explicitly checked against that schema rather
  than duplicated as an unchecked cast.
- **Confirmed projection seam:** protocol parsing, RenderState model/fold and orchestration are
  framework-independent TypeScript modules. The fold consumes complete response/event envelopes,
  returns `applied | ignored | resync_required`, and never imports Tauri, Svelte or DOM APIs.
- **Confirmed orchestration seam:** one controller owns listener-first boot, snapshot-in-flight
  state, a bounded 256-event buffer, epoch/seq replay and one automatic resync attempt per
  degradation episode. Failure becomes an explicit disconnected state; it never retries without
  bound. The bridge continues to accept only `DesktopCommand` intent.
- **Open questions:** None. Package versions are implementation inputs, not protocol decisions.
- **Scope:** `crates/moontide-desktop/frontend/**`, R4 status and Implementation Evidence in the
  feature/task documents. The Tauri product path remains on the transitional static entry until R5.
- **Non-goals:** porting the product UI to Svelte, changing visible layout, CSP/global-Tauri
  tightening, deleting Rust RenderState/UI, process transport, settings or protocol v1 changes.
- **Agent Task:** Complete TASK-14 through TASK-17, run frontend focused gates plus Rust/workspace
  regression gates, and produce Implementation Evidence.
- **Reviewer:** Tidewatch in an independent context after implementation evidence is ready.
- **User Parallel Task:** Compare the nine Rust RenderState scenarios with the TypeScript parity
  matrix; do not modify `crates/moontide-desktop/frontend/**` during this batch.
- **Shared Acceptance:** `check`, fixture conformance tests and production build pass; all Rust fold
  invariants have named TypeScript coverage; boot subscribes before handshake; events are buffered
  during snapshot; stale/gap/new-epoch/explicit/orphan-result paths are deterministic; resync
  failure is bounded and observable; `just check` remains green.
- **Decision changes:** none. TypeScript types describe the already-frozen v1 JSON; they do not
  change identity ownership or introduce a second wire contract. Discovery showed that pointing
  `frontendDist` at ignored build output makes direct Cargo checks fail on a clean checkout, so the
  runtime path switch is deferred to R5 where build orchestration and UI ownership change together.
- **Next smallest experiment:** parse all 30 top-level fixture envelopes with one schema and assert
  command/response/event identity before implementing the fold.
- **Stop conditions:** required v1 shape/version change, a Rust product-state consumer that blocks
  later deletion, need for a shared frontend/client crate, unbounded retry/buffering, framework or
  DOM dependency in the fold, or package installation that overwrites unrelated work.

### R4 Implementation Evidence

- **Changed files:** locked npm/Svelte/TypeScript/Vite/Vitest baseline; strict runtime protocol
  schema and fixture tests; pure RenderState model/fold and Rust-parity tests; framework-neutral
  Desktop controller and delivery-orchestration tests; synchronized feature/task status.
- **Diff size:** 1,979 TypeScript/Svelte source and test lines plus 70 package/config lines. The npm
  lockfile adds 1,594 mechanical lines for 101 resolved non-root package entries.
- **Frontend validation:** `npm run check` passed with zero errors/warnings; `npm test` passed 23
  tests in four files; `npm run build` produced a bounded production bundle successfully.
- **Rust regression validation:** `cargo test -p moontide-desktop` passed 12 tests. `just check`
  passed format, workspace/all-target clippy and all 331 Rust tests after the frontend work.
- **Contract result:** one strict Zod graph validates runtime input and supplies TypeScript types,
  with its recursive ContentBlock algebra type-checked explicitly. It round-trips the committed 8
  command, 8 response and 14 event fixtures, rejects invalid correlation/delivery identities and
  represents Rust externally tagged nested enums explicitly.
- **Projection result:** the pure fold has named parity coverage for all nine Rust RenderState
  scenarios: draft replacement/stale update/gap, finalized calls, orphan ToolResult, snapshot
  baseline, active-draft retention, new epoch, TurnCompleted, tool/approval/failure and command
  error recoverability. It imports no Svelte, Tauri or DOM API.
- **Orchestration result:** the controller subscribes before Handshake, buffers the triggering and
  subsequent events during snapshot, ignores stale baseline-covered events, replays seq in arrival
  order, handles new epoch/explicit/orphan/gap degradation, caps the buffer at 256 and performs at
  most one snapshot attempt per degradation episode before observable disconnection. Typed domain
  rejection remains a response; malformed bridge data disconnects; degraded close evidence remains
  an explicit connection state.
- **Build-path discovery:** pointing Tauri `frontendDist` directly at ignored `dist/` made clean
  Cargo checks fail before npm build. The experiment was reverted; R4 keeps the transitional static
  runtime entry, while R5 must switch UI ownership and Tauri build orchestration together.
- **Toolchain result:** npm initially selected unsupported TypeScript 7 for ordinary
  `svelte-check`; the lockfile now pins supported TypeScript 6 rather than enabling experimental
  dual-compiler `tsgo` behavior.
- **Deferred by scope:** the current product entry still uses the R3 plain-JavaScript projection.
  Svelte component integration, real WebView smoke, CSP/global-Tauri tightening and removal of
  dynamic HTML are TASK-18/19 in R5; legacy Rust projection remains until that parity is reviewed.
- **Tidewatch:** independent Standards/Spec review passed with no findings. The final review
  verified strict parsing and identity coverage for all 30 fixtures, parity coverage for all nine
  Rust projection scenarios, listener-first and bounded resync behavior, framework-independent
  protocol/fold/controller modules, and accurate implementation evidence. Real WebView integration
  remains intentionally deferred to R5.

## Work Packet: D3-PF / R5 (Review Batch R5)

- **Base:** `feat/assistant-host/r2` at `500c183`; worktree clean at batch start.
- **Mode:** Implementation; the protocol v1 graph and Rust public contracts remain unchanged.
- **Goal:** Replace the transitional plain-JavaScript product projection with a minimal Svelte UI
  that renders only the R4 TypeScript `RenderState`, sends intent only through
  `DesktopController`, and runs under a minimized Tauri capability/CSP configuration.
- **Current hypothesis:** a small root component plus pure presentation helpers is sufficient to
  preserve the existing conversation, composer, streaming assistant, tool/approval, notice,
  cancel and connection-state behavior. The bundled `@tauri-apps/api` imports can replace
  `window.__TAURI__`, allowing `withGlobalTauri` to be disabled without adding another bridge.
- **Source of truth:** TASK-18/19 in `tauri-protocol-boundary-refactor.md`; R4
  `protocol.ts`/`renderState.ts`/`controller.ts`; the transitional `index.html`/`main.js` visible
  behavior; Tauri v2 config/capability schemas; current shell static guards and tests.
- **Confirmed decisions:** Web frontend owns render state, input draft, UI preferences and
  connection state; Tauri Rust owns the single `desktop_request` capability, event delivery and
  window close lifecycle. Components consume state and emit typed intent; they do not parse
  envelopes, request snapshots, own boot/resync, or call multiple business commands directly.
  Protocol-derived text is rendered as escaped text; dynamic `innerHTML`/`{@html}` is forbidden.
- **Open questions:** None at the architecture level. Implementation evidence confirmed the
  minimal bundled IPC CSP and the tracked empty build-output marker required by clean Cargo checks.
- **Evidence:** R4 supplies strict fixture parsing, nine-case projection parity and bounded
  listener-first orchestration. Live R5 discovery confirms the remaining product entry still uses
  `window.__TAURI__`, duplicate local projection and one dynamic `innerHTML`; Tauri config still
  has `withGlobalTauri: true`, `csp: null` and an unused JavaScript window-close permission.
- **Scope:** `crates/moontide-desktop/frontend/**`, the root ignore exception needed to retain an
  empty build-output marker, Tauri frontend build configuration, `capabilities/default.json`,
  shell security/static tests and R5 status/evidence in these two architecture documents.
- **Non-goals:** visual redesign, Session Rail/settings/Inspector, provider/bootstrap changes,
  process transport, protocol v1 changes, and R6 deletion of Rust UI/RenderState or duplicate
  public protocol types.
- **Agent Task:** complete TASK-18/19; add component/presentation and bridge evidence; wire Vite
  into Tauri dev/build; enforce CSP/global/capability/no-dynamic-HTML guards; run frontend, focused
  Tauri, workspace and real-WebView smoke where the local environment permits.
- **Reviewer:** Tidewatch in an independent context after Implementation Evidence is complete.
- **User Parallel Task:** Trace one user action (`Submit`, `Cancel` or approval) from the Svelte
  handler through `DesktopController.send` to `desktop_request`, and verify that no component owns
  request IDs, epochs, sequence numbers or snapshot recovery. Do not modify the scoped files while
  R5 is active.
- **Shared Acceptance:** the product entry is Svelte; visible state is derived from TypeScript
  `RenderState`; all user commands flow through one controller and one bridge; streaming, tools,
  approvals, errors, cancel, resync/disconnect and close have automated or reproducible smoke
  evidence; frontend check/test/build, focused Tauri tests and `just check` pass; CSP is non-empty,
  global Tauri is off, capabilities are minimal and no dynamic HTML rendering remains.
- **Decision changes:** L1 build-path evidence required a tracked `dist/.gitkeep` plus a scoped
  prebuild cleaner because `tauri::generate_context!` rejects a missing `frontendDist` before the
  Tauri CLI can run `beforeBuildCommand`. The existing PNG replaced the non-bundleable SVG icon.
  Independent review also exposed that terminal events did not refresh conversation history;
  `DesktopController` now buffers `TurnCompleted`/`TurnFailed`, loads the authoritative Session
  snapshot, and then replays later events. These changes do not affect protocol v1, component
  ownership or R6 scope.
- **Next smallest experiment:** Tidewatch inspects the complete R5 diff and reruns the frontend,
  Tauri security and build-path gates before user diff review.
- **Stop conditions:** any required protocol shape/version change; UI ownership of runtime facts;
  a second Tauri business command; need for settings/Session picker/provider behavior; CSP or build
  changes that cannot preserve clean Cargo checks; or unrelated concurrent modifications in scope.

### R5 Implementation Evidence

- **Changed files:** Svelte product entry/component and presentation helpers; injected
  `DesktopControllerPort`; module-based Tauri bridge; DOM/intent/bridge tests; Vite/Tauri build
  handoff and tracked empty output marker; CSP/capability/static guards; deletion of the duplicate
  plain-JavaScript projection and temporary toolchain probe; synchronized architecture status.
- **Diff size:** 1,623 reviewable product/config/test line changes before these final evidence edits
  (1,275 additions, 348 deletions), plus 823 mechanical lockfile lines. The lock now records 163
  non-root package entries. TASK-18/19 remain one UI/security ownership switch despite the total
  diff being slightly above the ~2,000-line soft budget when the lockfile is counted.
- **Frontend validation:** clean `npm ci` installed 139 packages from the lock; `npm run check`
  passed with zero errors/warnings; `npm test` passed 34 tests in six files; `npm run build` produced
  a 134.86 kB JavaScript and 2.52 kB CSS production bundle.
- **UI result:** the Svelte component reads only `DesktopViewState`, renders conversation/history,
  assistant drafts, live tools, approvals, notices, delivery/connection evidence and composer
  modes, and sends typed submit/cancel/approve/deny intents only through `DesktopController.send`.
  Thinking remains hidden from the conversation. DOM evidence proves protocol text is escaped.
  A real controller/component composition test proves a submitted user message enters the visible
  conversation only after a terminal authoritative snapshot; controller tests cover buffered event
  ordering and terminal-snapshot failure without making the component own Session facts.
- **Security result:** `window.__TAURI__`, dynamic `innerHTML`/`{@html}`, direct business invokes and
  the JavaScript close permission are absent. The frontend imports `invoke`/`listen` from the
  official Tauri API; capability scope contains only event listen/unlisten and `desktop_request`;
  `withGlobalTauri` is false and production CSP is non-empty and local/IPC-scoped.
- **Build-path result:** with generated bundle assets moved aside and only tracked `.gitkeep`
  present, `cargo check -p moontide-desktop` passed. The prebuild cleaner preserves the marker while
  deleting stale generated assets before each Vite build. A normal debug `.app` bundle completed
  after switching the committed icon from unsupported SVG to the existing PNG.
- **Runtime smoke:** the bundled macOS app launched with a non-secret placeholder key and no model
  request; the WebView reached Idle/Connected, created a new Session, rendered the Svelte UI,
  enabled Send after a local draft, and exited cleanly through the native close button. Streaming,
  cancel, approval and resync are covered by DOM/controller/transport automation rather than a
  live provider smoke, which would require external credentials and network side effects.
- **Rust regression validation:** `cargo test -p moontide-desktop` passed all 12 tests; `just check`
  passed format, workspace/all-target clippy and all 331 Rust tests.
- **Residual warning:** Tauri warns that the existing bundle identifier `dev.moontide.app` ends in
  `.app`. Changing installed-app identity is outside this batch and remains an explicit later
  product decision; it did not block the debug bundle or runtime smoke.
- **Tidewatch:** first review found one P1 conversation-history gap. After the controller-owned
  terminal snapshot refresh, compositional regression coverage and competing-resync race guard
  were added, the final independent Standards/Spec re-review passed with no findings.

## Work Packet: D3-PF / R6 (Review Batch R6)

- **Base:** `feat/assistant-host/r2` at `375731e`; worktree clean at batch start.
- **Mode:** Implementation; live deletion discovery is complete and found no architecture-level
  stop condition.
- **Goal:** Leave one public Desktop wire graph and one product `RenderState`, remove the legacy
  Iced path and transitional exports/dependencies, and close D3-PF with auditable evidence.
- **Current hypothesis:** the active Host protocol server already consumes `desktop-protocol`
  directly. The retained half of the transitional `wire.rs` can become a private
  `host_protocol` adapter; the parallel protocol graph, Rust projection and Iced UI can then be
  deleted without changing Host lifecycle, protocol v1 or the Tauri/frontend path.
- **Source of truth:** TASK-20–24 and completion criteria in
  `tauri-protocol-boundary-refactor.md`; `desktop`/`desktop-protocol`/`moontide-desktop` README and
  DESIGN documents; current manifests, exports, source imports and R4/R5 parity/review evidence.
- **Confirmed decisions:** `desktop-protocol` remains the only public wire contract; Web frontend
  owns the only product `RenderState`; `DesktopHost`/`EventBuffer` facts and tests remain; the
  Host-side adapter alone converts canonical Agent values to wire DTOs. No compatibility shim is
  added for the explicitly approved legacy public Rust graph deletion.
- **Open questions:** None. The direct `desktop → agent-core` dependency remains necessary inside
  the private adapter for nested Session/Tool value conversion. Expanding the `agent` public
  facade only to hide that dependency would increase coupling without changing ownership.
- **Evidence:** workspace source search found no consumer of the legacy protocol exports,
  `recv_protocol`, `run_ui` or Rust `RenderState` outside `desktop` itself. Tauri imports only the
  `DesktopProtocolServer` seam. Root/workspace Iced usage is confined to the legacy UI. R4/R5
  independently verified TypeScript protocol parsing, projection parity, snapshot ordering,
  product rendering and terminal authoritative refresh.
- **Scope:** `crates/desktop/src/{lib,event,host_protocol}` and private adapter/tests; delete
  `protocol.rs`, `render_state*` and `ui*`; root/desktop manifests and lockfile; affected Desktop,
  Tauri, protocol and feature/task documentation.
- **Non-goals:** protocol v1 shape/version changes, D4 process transport or supervisor wiring,
  settings/Session Rail/provider behavior, Host lifecycle changes, visual redesign or compatibility
  wrappers for removed transitional exports.
- **Agent Task:** first isolate the direct Host-to-wire adapter, then delete the parallel graph and
  Rust UI/projection, remove Iced, run source/dependency audits, synchronize docs, execute focused
  and workspace gates, and produce Implementation Evidence.
- **Reviewer:** Tidewatch in an independent context after implementation evidence is complete.
- **User Parallel Task:** trace `DesktopEvent → host_protocol::adapter → DesktopProtocolEvent` for
  one streaming or tool event and confirm that the deleted `desktop::protocol` graph is not on the
  active path. Do not modify the R6 scoped files while implementation is active.
- **Shared Acceptance:** one public wire graph and one product `RenderState`; Host/EventBuffer and
  Tauri lifecycle behavior remain covered; no Iced dependency remains; Tauri frontend still passes
  fixture/check/test/build; focused Rust tests and `just check` pass; documentation distinguishes
  current in-process D3-PF from future D4 transport replacement.
- **Decision changes:** retain the direct `agent-core` production dependency because the sole
  private wire adapter must map canonical nested Session/Tool payloads not exposed by `agent`.
  Re-exporting those implementation types would widen a stable public facade only to alter the
  manifest graph.
- **Next smallest experiment:** move only the retained direct conversion functions under
  `host_protocol`, compile the Host protocol tests, then delete the now-unreferenced parallel graph.
- **Stop conditions:** any external real consumer of removed Rust exports; required protocol v1,
  Agent/Session/Approval ownership or persistence change; lost Host/EventBuffer invariant; D4,
  settings or UI product expansion; concurrent changes in scoped files.

### R6 Implementation Evidence

- **Changed files:** private Host canonical-to-wire adapter; Host protocol imports and public
  exports; removal of the parallel Rust protocol graph, Rust product projection and Iced UI;
  workspace/desktop manifests and lockfile; synchronized Desktop/protocol/Tauri architecture docs.
- **Pre-review implementation snapshot:** 37 files, 916 insertions and 6,287 deletions, including
  the new 510-line private
  adapter that is not represented by an unstaged `git diff --shortstat`. Most deletion is the Iced dependency
  lock graph and the approved legacy Rust UI/projection/protocol implementation.
- **Protocol and ownership audit:** workspace source search finds public `DesktopCommand`,
  `DesktopResponse`, `DesktopProtocolEvent` and `DesktopMessageEnvelope` only in
  `desktop-protocol`. The remaining `desktop::DesktopCommandError` and
  `DesktopProtocolEventStream` are Host domain/server seams, not a second wire graph. Tauri shell
  modules do not import `DesktopHostHandle`, `AgentConfig` or `SessionSelection`.
- **Projection and dependency audit:** the only product `RenderState` definition is
  `frontend/src/renderState.ts`. No Iced manifest/lock entry remains. `cargo tree -p desktop -e
  normal --depth 1` contains only `agent`, `agent-core`, `desktop-protocol`, `anyhow`, `tokio` and
  `tokio-util`; direct `agent-core` ownership is limited to the private adapter's nested canonical
  value mapping.
- **Focused Rust validation:** `cargo test -p desktop-protocol` passed 6 tests;
  `cargo test -p desktop` passed 21 tests; `cargo test -p moontide-desktop` passed 12 tests. Tests
  using wiremock required loopback permission in the managed sandbox; reruns with that permission
  passed without code changes.
- **Frontend validation:** `npm run check` passed with zero errors/warnings; `npm test` passed 34
  tests in six files; `npm run build` produced the production bundle successfully.
- **Workspace validation:** `just check` passed `cargo fmt --all --check`, workspace/all-target
  clippy and the full workspace test suite. `git diff --check` passed.
- **Smoke evidence:** the automated in-process vertical-slice test passed Handshake, Session boot,
  protocol request/event flow and shutdown through the same server/client/transport seams used by
  Tauri. R5's real WebView smoke remains the UI integration evidence because R6 changes no Tauri
  or frontend runtime source; credentialed provider smoke remains D6 scope.
- **Contract result:** protocol v1 JSON, Agent/Session/Approval ownership, Session Item Log,
  Host lifecycle and public D1 Host methods are unchanged. D3-PF remains same-process and
  protocol-first; D4 remains a transport/process-supervision replacement only.
- **Residual risk:** removal of the approved transitional Rust exports is intentionally breaking
  for an undiscovered external consumer; workspace/source discovery found none, so no compatibility
  shim was added. Cross-platform packaging and real-provider smoke remain D6 work.
- **Tidewatch:** independent Standards/Spec review passed with no remaining findings after stale
  RenderState, process-architecture, diff-accounting and bounded-resync documentation were aligned
  with live source. The reviewer independently passed `just check`, frontend check/test/build and
  the source/dependency audits; the 510-line untracked adapter was included in review.

## Task details

### TASK-01: Establish task control

- **Do:** Record review batches, the current Work Packet and completion gates in a durable task file.
- **Depends on:** None.
- **Scope:** `crates/docs/tauri-protocol-boundary-refactor-TASKS.md`.
- **Estimated diff:** ~180 lines.
- **Completion:** R1 scope and acceptance are reviewable from this file.
- **Status:** Complete.

### TASK-02: Add protocol v1 fixtures

- **Do:** Commit deterministic command, response and event envelope fixtures covering every
  top-level protocol variant without secrets or machine-specific paths.
- **Depends on:** TASK-01.
- **Scope:** `crates/desktop-protocol/tests/fixtures/**`.
- **Estimated diff:** ~420 lines.
- **Completion:** Rust can deserialize every fixture into public DTOs.
- **Status:** Complete.

### TASK-03: Add conformance and validation evidence

- **Do:** Test variant coverage, JSON round trips and envelope identity invariants; document the
  v1 validation and failure rules without changing wire shape.
- **Depends on:** TASK-02.
- **Scope:** `crates/desktop-protocol/tests/**`, `crates/desktop-protocol/DESIGN.md`.
- **Estimated diff:** ~250 lines.
- **Completion:** `cargo test -p desktop-protocol`.
- **Status:** Complete.

### TASK-04: Validate command envelopes and handshake

- **Do:** Add a Host-side adapter that validates wire commands and establishes a connection epoch
  through handshake without importing Tauri.
- **Depends on:** TASK-03.
- **Scope:** `crates/desktop/src/host_protocol/**` and module wiring.
- **Estimated diff:** ~300 lines.
- **Completion:** Focused handshake and invalid-envelope tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-05: Route Session boot and snapshot

- **Do:** Route StartSession and Snapshot through the adapter while keeping the Session Item Log
  authoritative and preserving typed lifecycle errors.
- **Depends on:** TASK-04.
- **Scope:** Host protocol adapter and focused tests.
- **Estimated diff:** ~300 lines.
- **Completion:** New/resume boot and snapshot tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-06: Route turn, cancellation and approval

- **Do:** Map SubmitTurn, CancelTurn, Approve and Deny to Host commands and return correlated typed
  responses for success and rejection.
- **Depends on:** TASK-05.
- **Scope:** Host protocol adapter and focused tests.
- **Estimated diff:** ~300 lines.
- **Completion:** Success, Busy, NoActiveTurn and approval error tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-07: Route shutdown and connection closure

- **Do:** Preserve Host cleanup while making shutdown completion and transport closure observable
  through protocol responses/events.
- **Depends on:** TASK-06.
- **Scope:** Host protocol adapter and lifecycle tests.
- **Estimated diff:** ~200 lines.
- **Completion:** Graceful and abnormal closure tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-08: Emit wire events directly

- **Do:** Convert EventBuffer output at the Host boundary with one epoch/seq mapping and remove the
  extra public event-envelope hop from the active path.
- **Depends on:** TASK-04.
- **Scope:** Host event adapter, conversion code and tests.
- **Estimated diff:** ~300 lines.
- **Completion:** Event identity, coalescing and resync tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-09: Add the protocol client

- **Do:** Implement request allocation, pending response correlation, connection state and event
  subscription against an abstract envelope transport.
- **Depends on:** TASK-04, TASK-08.
- **Scope:** Tauri crate pure Rust client module and tests.
- **Estimated diff:** ~400 lines.
- **Completion:** Fake-transport client tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-10: Add in-process transport

- **Do:** Connect the protocol client to the Host adapter with bounded in-process channels while
  keeping the same envelope contract expected from D4.
- **Depends on:** TASK-09.
- **Scope:** Composition/transport modules and end-to-end tests.
- **Estimated diff:** ~350 lines.
- **Completion:** Boot, command, event and shutdown flow passes end to end.
- **Status:** Complete; Tidewatch passed.

### TASK-11: Separate application composition

- **Do:** Move current config/session/runtime assembly outside the Tauri shell and inject an already
  constructed protocol client without changing settings behavior.
- **Depends on:** TASK-10.
- **Scope:** Tauri binary composition and bootstrap modules.
- **Estimated diff:** ~250 lines.
- **Completion:** Shell modules no longer construct AgentConfig or store Host handles.
- **Status:** Complete; Tidewatch passed.

### TASK-12: Replace direct Tauri commands

- **Do:** Replace five Host-specific invoke handlers with one allowlisted protocol-envelope bridge
  and preserve domain rejections as protocol responses.
- **Depends on:** TASK-11.
- **Scope:** Tauri bridge, permissions and frontend call seam.
- **Estimated diff:** ~350 lines.
- **Completion:** Static search and bridge tests show no direct Host command path.
- **Status:** Complete; Tidewatch passed.

### TASK-13: Add graceful window close

- **Do:** Send protocol Shutdown before normal window close and expose degraded close evidence when
  transport or cleanup fails.
- **Depends on:** TASK-12.
- **Scope:** Tauri window lifecycle and tests/checklist.
- **Estimated diff:** ~200 lines.
- **Completion:** Close-path test/smoke evidence is recorded.
- **Status:** Complete; Tidewatch passed.

### TASK-14: Add Svelte and TypeScript baseline

- **Do:** Establish the minimal build, typecheck and unit-test toolchain without redesigning the UI.
- **Depends on:** TASK-12.
- **Scope:** `crates/moontide-desktop/frontend/**` and Tauri frontend configuration.
- **Estimated diff:** ~350 lines.
- **Completion:** Frontend check, test and build scripts pass.
- **Status:** Complete; Tidewatch passed.

### TASK-15: Consume protocol fixtures in TypeScript

- **Do:** Define or generate TypeScript wire types and prove all Rust fixtures conform to them.
- **Depends on:** TASK-03, TASK-14.
- **Scope:** Frontend protocol types and conformance tests.
- **Estimated diff:** ~350 lines.
- **Completion:** Every fixture variant passes TypeScript validation/tests.
- **Status:** Complete; Tidewatch passed.

### TASK-16: Port the pure RenderState fold

- **Do:** Port confirmed Rust projection behavior into a DOM- and framework-independent TypeScript
  reducer using shared fixtures.
- **Depends on:** TASK-15.
- **Scope:** Frontend state model/fold and unit tests.
- **Estimated diff:** ~650 lines.
- **Completion:** Rust parity matrix passes for state, assistant, tool, approval and failure paths.
- **Status:** Complete; Tidewatch passed.

### TASK-17: Add boot and resync orchestration

- **Do:** Implement listener-first boot, snapshot buffering, epoch/seq validation and bounded resync
  without replaying old epochs.
- **Depends on:** TASK-09, TASK-16.
- **Scope:** Frontend protocol client orchestration and tests.
- **Estimated diff:** ~450 lines.
- **Completion:** Race, gap, new-epoch and resync-failure tests pass.
- **Status:** Complete; Tidewatch passed.

### TASK-18: Port the minimal conversation UI

- **Do:** Render conversation, composer, assistant streaming, tool/approval/error and stop entirely
  from TypeScript RenderState while preserving current D3-R2 behavior.
- **Depends on:** TASK-17.
- **Scope:** Svelte components and UI integration tests/smoke checklist.
- **Estimated diff:** ~900 lines.
- **Completion:** Minimal Desktop smoke scenarios work through the envelope bridge.
- **Status:** Complete; Tidewatch passed; committed in R5 (`375731e`).

### TASK-19: Apply the security baseline

- **Do:** Minimize Tauri capabilities/global API, add CSP and remove unsafe dynamic HTML rendering.
- **Depends on:** TASK-18.
- **Scope:** Tauri config/capabilities and frontend rendering.
- **Estimated diff:** ~300 lines.
- **Completion:** Security static checks and Desktop smoke pass.
- **Status:** Complete; Tidewatch passed; committed in R5 (`375731e`).

### TASK-20: Remove duplicate public protocol graph

- **Do:** Delete the parallel `desktop` public command/response/envelope types after all consumers
  use `desktop-protocol`, without adding an unneeded compatibility shim.
- **Depends on:** TASK-12, TASK-17.
- **Scope:** `crates/desktop` protocol exports, adapter and tests.
- **Estimated diff:** ~500 lines changed.
- **Completion:** Workspace source search finds one public wire graph.
- **Status:** Complete; one public wire graph remains.

### TASK-21: Remove legacy Rust UI and RenderState

- **Do:** Delete the Iced UI and Rust UI projection only after TypeScript parity is independently
  verified, while preserving Host/EventBuffer runtime tests.
- **Depends on:** TASK-16, TASK-18.
- **Scope:** Legacy desktop UI/projection modules and dependencies.
- **Estimated diff:** ~900 lines deleted.
- **Completion:** No Iced dependency or second product RenderState remains.
- **Status:** Complete; TypeScript parity/review preceded deletion.

### TASK-22: Tighten dependency direction

- **Do:** Remove transitional dependencies/exports and leave conversion ownership at the narrowest
  Host-side boundary.
- **Depends on:** TASK-20, TASK-21.
- **Scope:** Desktop/Tauri/workspace manifests and module exports.
- **Estimated diff:** ~150 lines changed.
- **Completion:** Dependency tree matches the approved ownership model.
- **Status:** Complete; conversion is private to `host_protocol` and Iced dependencies are gone.

### TASK-23: Synchronize architecture documentation

- **Do:** Mark D3-PF as implemented, distinguish it from D4 and document remaining transport-only
  work without claiming daemon or multi-process support.
- **Depends on:** TASK-22.
- **Scope:** Desktop/Tauri/protocol README and DESIGN documents.
- **Estimated diff:** ~250 lines changed.
- **Completion:** Documentation matches live imports and runtime path.
- **Status:** Complete; live crate and feature documents distinguish D3-PF from D4.

### TASK-24: Produce completion evidence

- **Do:** Run focused and workspace validation, complete Standards/Spec review, record smoke evidence
  and audit every feature acceptance criterion against live source.
- **Depends on:** TASK-23.
- **Scope:** Tests, evidence sections and final review report.
- **Estimated diff:** ~100 lines documentation.
- **Completion:** The feature document completion definition is fully evidenced.
- **Status:** Complete; focused/workspace evidence and independent review passed; user authorized commit.
