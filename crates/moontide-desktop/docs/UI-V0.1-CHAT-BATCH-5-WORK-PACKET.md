# Work Packet: Desktop Chat / Batch 5

- **Base:** `feat/desktop-ui` at `28e062f`; Batch 1-4 and the surrounding Desktop migration remain mixed with unrelated uncommitted work in the live checkout.
- **Mode:** Implementation.
- **Version goal:** v0.1 Loaded Conversation reading surface over the existing typed Controller and `RenderState` contracts.
- **Goal:** replace the temporary Card-based Loaded extraction with one stable reading column containing typed user, assistant, thinking, tool, approval, and notice blocks; keep the Composer fixed at the bottom, preserve the reader's scroll position during streaming, and replace the responsive overlay with a docked, horizontally resizable Session drawer.
- **Current hypothesis:** the current `RenderState` already contains enough canonical message, draft, tool, approval, notice, and delivery facts. Batch 5 needs only pure UI projection and frontend-local disclosure/copy/reading-anchor state.
- **Source of truth:** `DESIGN.md`, `UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md` §9/§11, `UI-STATE.md`, `UI-INTERACTION.md` §7-8, `UI-VISUAL-DIRECTION.md` §7-9, frontend `README.md`, Batch 4 Work Packet, current source and tests.
- **Confirmed decisions:** Host remains the owner of Session/Turn/tool/approval facts; Controller remains the owner of sequencing and resync; Svelte owns rendering, disclosure, clipboard feedback, reading anchor, and Session drawer open/width state only. `desktopController.ts` remains frozen. Loaded identity continues to come only from the authoritative Session snapshot. The Session drawer is a docked layout pane at every validated viewport, not a modal layer; its default width is `240px`, drag range is `200–360px`, and it can be fully collapsed from the Top Bar. The Top Bar and drawer do not display connection badges; connection is only explained inline when it blocks or degrades an action.
- **Scope:** pure Loaded presentation models in `projection/uiModel.ts`; focused Chat feature components; `LoadedConversation.svelte`, docked Session drawer, and Loaded Composer placement in `ChatShell.svelte`; focused projection/App tests; documentation and validation evidence.
- **Non-goals:** Rust, protocol, bridge, Controller, Session persistence, queued-prompt dispatch, terminal-event semantics, new retries, message edit/regenerate/fork/export/read-aloud/delete, attachments, model controls, sound, a one-item global Status Bar, Batch 6 final accessibility/contrast/real-Tauri QA.
- **Risks:** tool call/result can render twice unless paired by canonical ID; draft finalization can create a visual duplicate; streaming can steal scroll position; raw tool input must not enter clipboard status or accessible names; notices lack a persisted chronological item identity and therefore can only remain inline with the reading column, not be positioned as canonical Session items; a wide drawer can starve the reading surface unless its width is bounded; pointer-only resizing would exclude keyboard users.

## Tasks

| Task | Deliverable | Acceptance |
|---|---|---|
| B5-1 Presentation model | paired historical/live tool items, explicit seven-outcome labels, safe display helpers | Host order is preserved; one tool identity renders once; `OutcomeUnknown` is not collapsed into Failed |
| B5-2 Typed blocks | user bubble, plain assistant surface, thinking/tool disclosure, approval and notice blocks, Copy | no large assistant Card; draft/final use the same geometry; unsupported actions are absent |
| B5-3 Reading anchor | stable 720-800px reading/Composer axis, bottom-follow threshold and `Jump to latest` | at-bottom follows new content; detached reading position is preserved; Jump restores the anchor |
| B5-4 Session drawer | docked layout pane with local open/width state, pointer drag and keyboard resize | default `240px`; bounded `200–360px`; collapse restores the Main width; `960×720` remains side-by-side and creates no modal/overlay |
| B5-5 Tests | projection and App tests for long text, streaming replacement/finalization, all tool outcomes, approval, failure/resync, scroll and drawer layout | page layout remains Loaded; drawer resizing is keyboard-accessible; canonical facts still come only from Controller state |
| B5-6 Validation | frontend checks/build, workspace check, diff check and independent review | no unresolved Standards/Spec P0/P1/P2; evidence and remaining Batch 6 work recorded |

- **Agent task:** implement B5-1 through B5-6 only in the scoped frontend/docs paths.
- **Reviewer:** independent Tidewatch after implementation.
- **User parallel task:** review the Loaded screen at `1440x900` and `960x720`; confirm the reading column is the sole content surface, user/assistant hierarchy is clear, the Composer does not cover the final block, streaming does not force a detached reader to the bottom, and dragging the Session drawer reflows rather than covers Main. Do not edit the same Chat feature files while this batch is active.
- **Shared acceptance:** one authoritative Loaded Session; chronological visible messages; typed inline blocks; seven distinct tool outcomes; one actionable approval owner; draft replaces in place and never coexists with its finalized form; sticky Composer; correct bottom-anchor behavior; docked/resizable/collapsible Session drawer with no overlay; no direct feature import of bridge/protocol; frontend and workspace gates pass; user diff review remains required before commit.
- **Evidence:** Batch 4 passed 70 frontend tests, typecheck, build, elevated `just check`, responsive browser layout checks, and independent Standards/Spec review. Current Loaded UI is a behavior-preserving Card extraction intentionally awaiting this batch.
- **Open questions:** safe automatic queued-prompt dispatch still lacks the terminal-proof contract required by the existing design notes; it remains outside this visual batch rather than being guessed from `run === idle`. A bottom Status Bar is deferred until MoonTide has multiple workspace-wide status/action consumers; connection alone does not justify a permanent surface.
- **Next smallest experiment:** replace `Sidebar.Root`'s off-canvas behavior with a feature-owned width boundary, then verify that pointer and keyboard resizing change layout width without creating business state.
- **Stop conditions:** any need to change Controller/Rust/protocol ownership, add persistent message state, infer a terminal outcome from UI timing, expose secrets in accessible/copy feedback, or add an unsupported product action returns to architecture alignment.

## Outcome

- Completed on 2026-09-01. Loaded renders one typed reading surface with stable assistant draft/final geometry, chronological historical/live tools, inline approvals/notices, a sticky Composer, detached reading preservation, and `Jump to latest`.
- Session navigation is a docked drawer with frontend-local open/width state. Browser geometry at `1440×900` and `960×720` confirmed the default `240px` pane occupies layout width, a pointer drag reaches `320px` and reflows Main, collapse removes the pane and reopening restores `320px`, and no `dialog`, backdrop, or overlay is created. The `960×720` default leaves a `720px` Main surface without horizontal clipping. The same boundary supports keyboard `←`/`→`/`Home`/`End` and exposes `200–360` value semantics.
- Persistent connection badges were removed from Top Bar and drawer. Starting, disconnected, degraded, and action failure explanations render beside the affected Composer; Retry is available for runtime recovery. A bottom Status Bar remains deferred until multiple workspace-wide consumers justify it.
- Validation: `pnpm run check` passed with 0 errors/0 warnings; 78/78 frontend tests passed; production build passed; `git diff --check` passed; elevated `just check` passed after the sandbox-only Wiremock port denial was removed.
- Independent Tidewatch Standards/Spec re-review found no remaining P0/P1/P2. User diff/visual review is still required before any commit.
- Batch 6 remains responsible for real Tauri smoke, final keyboard/IME/focus/live-region behavior, reduced motion, two-theme contrast, zoom specimens, and final visual QA evidence.
- Git: no commit requested.
