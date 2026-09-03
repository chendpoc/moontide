# Work Packet: Hybrid Shell v0.2 / Batch 1 Native Carrier Spike

- **Base:** `main` on the live checkout dated 2026-09-03. Existing modified/untracked
  `crates/moontide-desktop/src-tauri/icons/**` files belong to another work unit and must remain untouched.
- **Mode:** Discovery spike followed by Standards / Spec review. This is not product completion.
- **Version goal:** determine whether a Tauri-owned macOS `NSWindow` can satisfy the minimum Control Center
  window semantics before adopting a real `NSPanel` integration.
- **Product goal:** prove compact/expanded native frame behavior, focus, Spaces, screen anchoring and Workspace
  activation without changing Runtime facts or the v0.1 Session Chat.
- **Task document:** [`../features/HYBRID-SHELL-V0.2.md`](../features/HYBRID-SHELL-V0.2.md).
- **Source of truth:** repository `AGENTS.md`; the Feature document; current `DESIGN.md`, `shell.rs`,
  `tauri.conf.json`, capabilities; Tauri/TAO/Wry and `objc2-app-kit` source resolved by the current lockfile.
- **Confirmed decisions:** v0.2 Hybrid Shell is macOS-first; Workspace remains a normal window; Batch 1 uses a
  Tauri-created `NSWindow`; no Swift, `tauri-nspanel`, class replacement, Runtime projection or multi-Session UI.
- **Main risk:** a customized `NSWindow` may look correct but still steal focus, move across Spaces incorrectly,
  or break Tauri close/shutdown behavior. Only real-window evidence can resolve this.

## 1. Deliverable

Create a removable macOS-only `control-center` diagnostic window that proves:

```text
compact 280 × 52
    ↕ Rust/AppKit native frame transition
expanded 380 × 360
    → Open Workspace
```

The diagnostic Svelte surface may contain only labels and controls needed to exercise the window. It must say
`Native carrier spike` and must not display fake Agent, Session, Task, Approval or progress data.

Batch 1 ends with an evidence-backed decision:

```text
Adopt Option A · customized NSWindow is sufficient
or
Reject Option A · return to Architecture Alignment for NSPanel carrier
```

It does not silently continue into Runtime projection or product visual implementation.

## 2. Ownership and lifecycle

- Tauri Rust shell owns the `control-center` native window, its ephemeral mode and all AppKit calls.
- Svelte owns only diagnostic control intent and internal content rendering.
- `DesktopRuntimeCoordinator`, Host, Session Item Log, Turn and Approval code are unchanged.
- `control-center` close hides or destroys only the diagnostic window according to the spike implementation;
  it must not call Runtime shutdown.
- `main` close retains the current graceful Runtime shutdown path.
- Native mode commands target the fixed `control-center` label; the frontend cannot choose a window or frame.

## 3. Scope

Allowed implementation concerns:

- `crates/moontide-desktop/src-tauri/src/shell.rs`
- a new macOS-only module below `crates/moontide-desktop/src-tauri/src/shell/`
- `crates/moontide-desktop/src-tauri/Cargo.toml` target-specific direct dependency/features needed for
  `objc2-app-kit`
- `crates/moontide-desktop/src-tauri/tauri.conf.json`
- new scoped Tauri capability/permission files for native carrier intents
- `crates/moontide-desktop/frontend/src/app/App.svelte` only for explicit window-surface selection
- new files below `crates/moontide-desktop/frontend/src/lib/features/control-center/`
- focused Rust/TypeScript tests for identity, command validation and surface selection
- this Work Packet outcome and evidence section

Do not edit, generate, delete or re-encode any file under `src-tauri/icons/`.

## 4. Required behavior

### 4.1 Window creation

- Window label is exactly `control-center`.
- The main window continues to load the existing Session Chat without markup or state changes.
- The diagnostic window loads the dedicated spike surface through an explicit, testable surface discriminator.
- macOS constructs the window; non-macOS builds do not expose a non-functional Control Center entry.

### 4.2 Native mode transition

- `set_control_center_mode` accepts a closed `compact | expanded` enum and a boolean `reduce_motion` hint.
- Rust maps each mode to fixed logical geometry and calculates the AppKit frame.
- The top-right anchor remains stable during resize.
- AppKit work runs on the main thread.
- A native failure returns an error; Svelte keeps the last accepted mode and displays a diagnostic error.
- Svelte derives `reduce_motion` from `prefers-reduced-motion`; an explicit diagnostic toggle may force the
  same boolean. Either path requests a non-animated frame change without changing target geometry.

### 4.3 Focus and activation

- Showing compact must not activate MoonTide or steal keyboard focus from another application.
- Clicking the compact surface can expand it; expanded may become key only when interaction requires it.
- `Escape` in expanded returns to compact and restores a coherent focus state; it does not Stop a Turn or close
  the Runtime.
- `Open Workspace` shows, activates and focuses `main` without creating another Runtime.

### 4.4 Screen and Spaces

- Initial placement uses the screen containing `main`, falling back to the primary screen; subsequent frame
  changes use the Control Center's current screen `visibleFrame`, never hard-coded global coordinates.
- compact and expanded remain fully inside the visible screen bounds.
- Moving between displays with different scale factors does not drift or resize incorrectly.
- always-on-top and visible-on-all-workspaces behavior are tested independently and documented; the spike must
  not claim Vibe Island behavior from CSS alone.

### 4.5 Close behavior

- `CloseRequested` branches by window identity.
- Closing `control-center` never sets the app-wide Runtime shutdown gate.
- Closing `main` still requests graceful shutdown exactly once and destroys the relevant windows cleanly.
- Repeated close/mode intents are idempotent or return an explicit error; they do not panic.

## 5. Capability boundary

The diagnostic window receives only:

- event listen/unlisten if required by the Tauri frontend bootstrap;
- `set_control_center_mode`;
- `open_workspace`.

It must not receive Session, Turn, Approval, filesystem, shell, process, generic window or global Tauri authority.
The existing `default` capability remains scoped to `main`.

## 6. Forbidden implementation

- Casting a Tauri `NSWindow` pointer to `NSPanel` and calling panel-only methods.
- Calling `object_setClass`, defining an Objective-C `NSPanel` subclass, or copying `tauri-nspanel` internals.
- Adding `tauri-nspanel`, Swift, SwiftUI, a plugin crate or a generic macOS window abstraction.
- Exposing raw width, height, position, window label, level or collection flags to JavaScript.
- Connecting the spike surface to `DesktopController`, Runtime events, Session files or fixtures.
- Changing Desktop protocol DTOs, Agent types, Session Item Log or persistence.
- Reworking v0.1 visual design while touching `App.svelte`.
- Commit, push or broad staging.

## 7. Tests

### Rust structural tests

- exactly two known window identities are handled and only `main` can initiate Runtime shutdown;
- native mode deserialization rejects unknown values;
- fixed mode geometry and top-right frame calculation cover positive/negative screen origins;
- `control-center` capability excludes Runtime and dangerous plugin permissions;
- macOS native module is cfg-gated and non-macOS compile remains valid;
- source guard rejects `object_setClass` and an `NSWindow`-as-`NSPanel` cast pattern in the owned module.

Each Rust test must have a comment stating scenario, expected result and invariant/side-effect constraint.

### Frontend tests

- `main` selects the existing Session Chat surface;
- `control-center` selects only the diagnostic surface;
- compact/expanded intent is single-flight and failure preserves last accepted mode;
- `Escape` only collapses the diagnostic surface;
- no Runtime bridge command appears in the Control Center feature module.

## 8. Real-window acceptance matrix

Record OS version, hardware/display arrangement and observed result for each case:

| Scenario | Expected |
|---|---|
| show compact while another app owns focus | other app keeps keyboard focus |
| click compact → expanded | smooth native frame change; top-right anchor stable |
| press Escape | returns to compact; no Runtime action |
| Open Workspace | `main` is visible, key and frontmost |
| primary display | frame remains in `visibleFrame` |
| secondary display with different scale | no drift, clipping or incorrect size |
| switch Space / full-screen app | observed behavior matches documented policy |
| close Control Center | Runtime and main remain alive |
| close main during idle/active Turn | existing graceful shutdown semantics remain |
| reduced motion | target state remains clear without animated frame |

Screen recording or screenshots are supporting evidence; the written observation table is authoritative.

## 9. Validation commands

```bash
cargo test -p moontide-desktop
cargo clippy -p moontide-desktop --all-targets -- -D warnings
cd crates/moontide-desktop/frontend
pnpm test
pnpm run check
pnpm run build
git diff --check
just check
```

Run the Tauri window matrix from `crates/moontide-desktop/src-tauri` with the workspace-selected Rust toolchain.
If sandbox restrictions prevent real window or localhost checks, report the limitation and rerun only with the
required permission; do not reinterpret it as a source failure.

## 10. Review and stop conditions

After implementation:

1. stop editing;
2. run an independent Standards review against repository rules and unsafe/AppKit boundaries;
3. run an independent Spec review against the real-window matrix;
4. present the diff and evidence for user review;
5. do not commit until the user explicitly says `commit`.

Stop and return to Architecture Alignment if:

- compact cannot remain non-activating without breaking click interaction;
- Spaces or activation behavior requires real `NSPanel` semantics;
- Tauri's window ownership conflicts with AppKit frame/focus changes;
- safe implementation requires class replacement, Swift or a third-party panel dependency;
- the spike requires any Runtime/protocol/persistence change;
- unrelated icon or v0.1 UI work overlaps the allowed paths.

## 11. User Parallel Task

- **Type:** Product behavior review.
- **Goal:** judge whether the native carrier feels sufficiently low-interruption to justify avoiding a real
  `NSPanel` dependency.
- **Scope:** the ten scenarios in the real-window acceptance matrix.
- **Output:** `Adopt Option A` or `Reject Option A`, with the first failed behavior named.
- **Acceptance:** the decision is based on the real app, not a browser preview or implementation summary.
- **Boundary:** no source modification is required.

## 12. Outcome

Pending implementation and design review.
