# Tauri Protocol Boundary Refactor Tasks

> **Feature document:** [`tauri-protocol-boundary-refactor.md`](tauri-protocol-boundary-refactor.md)
> **Version goal:** D3-PF
> **Status:** R1 committed as `2cdf850`; R2 review passed and commit gate satisfied

## Review batches

| Review batch | Feature tasks | Theme | Estimated diff | Status |
|---|---|---|---:|---|
| R1 | 01–03 | Protocol v1 evidence and validation rules | ~700 | Committed (`2cdf850`) |
| R2 | 04–08 | Host-side protocol adapter | ~1,300 | Review passed; commit gate satisfied |
| R3 | 09–13 | Protocol client, in-process transport and Tauri bridge | ~1,600 | Pending |
| R4 | 14–17 | TypeScript contract, RenderState and resync orchestration | ~1,800 | Pending |
| R5 | 18–19 | Minimal Svelte UI and security baseline | ~1,400 | Pending |
| R6 | 20–24 | Transitional deletion, dependency cleanup and final evidence | ~1,500 | Pending |

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
- **Status:** Pending.

### TASK-10: Add in-process transport

- **Do:** Connect the protocol client to the Host adapter with bounded in-process channels while
  keeping the same envelope contract expected from D4.
- **Depends on:** TASK-09.
- **Scope:** Composition/transport modules and end-to-end tests.
- **Estimated diff:** ~350 lines.
- **Completion:** Boot, command, event and shutdown flow passes end to end.
- **Status:** Pending.

### TASK-11: Separate application composition

- **Do:** Move current config/session/runtime assembly outside the Tauri shell and inject an already
  constructed protocol client without changing settings behavior.
- **Depends on:** TASK-10.
- **Scope:** Tauri binary composition and bootstrap modules.
- **Estimated diff:** ~250 lines.
- **Completion:** Shell modules no longer construct AgentConfig or store Host handles.
- **Status:** Pending.

### TASK-12: Replace direct Tauri commands

- **Do:** Replace five Host-specific invoke handlers with one allowlisted protocol-envelope bridge
  and preserve domain rejections as protocol responses.
- **Depends on:** TASK-11.
- **Scope:** Tauri bridge, permissions and frontend call seam.
- **Estimated diff:** ~350 lines.
- **Completion:** Static search and bridge tests show no direct Host command path.
- **Status:** Pending.

### TASK-13: Add graceful window close

- **Do:** Send protocol Shutdown before normal window close and expose degraded close evidence when
  transport or cleanup fails.
- **Depends on:** TASK-12.
- **Scope:** Tauri window lifecycle and tests/checklist.
- **Estimated diff:** ~200 lines.
- **Completion:** Close-path test/smoke evidence is recorded.
- **Status:** Pending.

### TASK-14: Add Svelte and TypeScript baseline

- **Do:** Establish the minimal build, typecheck and unit-test toolchain without redesigning the UI.
- **Depends on:** TASK-12.
- **Scope:** `crates/moontide-desktop/frontend/**` and Tauri frontend configuration.
- **Estimated diff:** ~350 lines.
- **Completion:** Frontend check, test and build scripts pass.
- **Status:** Pending.

### TASK-15: Consume protocol fixtures in TypeScript

- **Do:** Define or generate TypeScript wire types and prove all Rust fixtures conform to them.
- **Depends on:** TASK-03, TASK-14.
- **Scope:** Frontend protocol types and conformance tests.
- **Estimated diff:** ~350 lines.
- **Completion:** Every fixture variant passes TypeScript validation/tests.
- **Status:** Pending.

### TASK-16: Port the pure RenderState fold

- **Do:** Port confirmed Rust projection behavior into a DOM- and framework-independent TypeScript
  reducer using shared fixtures.
- **Depends on:** TASK-15.
- **Scope:** Frontend state model/fold and unit tests.
- **Estimated diff:** ~650 lines.
- **Completion:** Rust parity matrix passes for state, assistant, tool, approval and failure paths.
- **Status:** Pending.

### TASK-17: Add boot and resync orchestration

- **Do:** Implement listener-first boot, snapshot buffering, epoch/seq validation and bounded resync
  without replaying old epochs.
- **Depends on:** TASK-09, TASK-16.
- **Scope:** Frontend protocol client orchestration and tests.
- **Estimated diff:** ~450 lines.
- **Completion:** Race, gap, new-epoch and resync-failure tests pass.
- **Status:** Pending.

### TASK-18: Port the minimal conversation UI

- **Do:** Render conversation, composer, assistant streaming, tool/approval/error and stop entirely
  from TypeScript RenderState while preserving current D3-R2 behavior.
- **Depends on:** TASK-17.
- **Scope:** Svelte components and UI integration tests/smoke checklist.
- **Estimated diff:** ~900 lines.
- **Completion:** Minimal Desktop smoke scenarios work through the envelope bridge.
- **Status:** Pending.

### TASK-19: Apply the security baseline

- **Do:** Minimize Tauri capabilities/global API, add CSP and remove unsafe dynamic HTML rendering.
- **Depends on:** TASK-18.
- **Scope:** Tauri config/capabilities and frontend rendering.
- **Estimated diff:** ~300 lines.
- **Completion:** Security static checks and Desktop smoke pass.
- **Status:** Pending.

### TASK-20: Remove duplicate public protocol graph

- **Do:** Delete the parallel `desktop` public command/response/envelope types after all consumers
  use `desktop-protocol`, without adding an unneeded compatibility shim.
- **Depends on:** TASK-12, TASK-17.
- **Scope:** `crates/desktop` protocol exports, adapter and tests.
- **Estimated diff:** ~500 lines changed.
- **Completion:** Workspace source search finds one public wire graph.
- **Status:** Pending.

### TASK-21: Remove legacy Rust UI and RenderState

- **Do:** Delete the Iced UI and Rust UI projection only after TypeScript parity is independently
  verified, while preserving Host/EventBuffer runtime tests.
- **Depends on:** TASK-16, TASK-18.
- **Scope:** Legacy desktop UI/projection modules and dependencies.
- **Estimated diff:** ~900 lines deleted.
- **Completion:** No Iced dependency or second product RenderState remains.
- **Status:** Pending.

### TASK-22: Tighten dependency direction

- **Do:** Remove transitional dependencies/exports and leave conversion ownership at the narrowest
  Host-side boundary.
- **Depends on:** TASK-20, TASK-21.
- **Scope:** Desktop/Tauri/workspace manifests and module exports.
- **Estimated diff:** ~150 lines changed.
- **Completion:** Dependency tree matches the approved ownership model.
- **Status:** Pending.

### TASK-23: Synchronize architecture documentation

- **Do:** Mark D3-PF as implemented, distinguish it from D4 and document remaining transport-only
  work without claiming daemon or multi-process support.
- **Depends on:** TASK-22.
- **Scope:** Desktop/Tauri/protocol README and DESIGN documents.
- **Estimated diff:** ~250 lines changed.
- **Completion:** Documentation matches live imports and runtime path.
- **Status:** Pending.

### TASK-24: Produce completion evidence

- **Do:** Run focused and workspace validation, complete Standards/Spec review, record smoke evidence
  and audit every feature acceptance criterion against live source.
- **Depends on:** TASK-23.
- **Scope:** Tests, evidence sections and final review report.
- **Estimated diff:** ~100 lines documentation.
- **Completion:** The feature document completion definition is fully evidenced.
- **Status:** Pending.
