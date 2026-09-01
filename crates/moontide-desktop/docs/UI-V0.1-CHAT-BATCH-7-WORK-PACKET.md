# Work Packet: Desktop Chat / Batch 7

- **Base:** `feat/desktop-ui` at `ac9a7d9`, with the uncommitted Batch 6A review unit preserved in the same worktree. Batch 7 changes must remain identifiable and must not rewrite unrelated Batch 6 behavior.
- **Mode:** Implementation in two review units: 7A removes redundant Session switching work; 7B adds bounded history delivery and `Load earlier messages`. Virtualization remains measurement-gated.
- **Version goal:** make Session selection feel local and predictable while keeping large histories bounded in the WebView.
- **Product goal:** selecting a settled historical Session performs only the work needed to establish its single active Agent and latest conversation window; older complete Turns load on demand without losing reading position.
- **Source of truth:** repository `AGENTS.md`; `DESIGN.md`; `UI-STATE.md`; `UI-INTERACTION.md`; `UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`; `agent-core` Session Item Log and current Desktop protocol/controller tests.
- **Ownership:** the Session Item Log remains the canonical full history. Rust `SessionQuery` owns persisted reads and complete-Turn paging. The Host owns active Session identity and runtime facts. The Controller owns request serialization and response ordering. `RenderState` owns the delivered history window. Svelte owns the `Load earlier messages` intent, loading/error presentation, and scroll-anchor preservation.
- **Identity and ordering:** history pages are scoped by `session_id` and use exclusive `before_turn`; page numbers and mutable array offsets are forbidden. A page contains complete Turns only. A response for a Session other than the currently loaded Session is rejected or ignored before projection.
- **Failure semantics:** catalog or history read errors are typed rejections and leave the current loaded history intact. A failed older-page request is retryable. Runtime shutdown/start failure retains the existing Batch 2 semantics.
- **Non-goals:** loading every Session history into frontend memory; database/index migration; multiple active Agents; read-only UI identity that differs from Host loaded identity; virtual-list height measurement; changing Agent model-context behavior; speculative background prefetch; changing persistence format.
- **Main risk:** pagination can split Tool/Approval facts from their Turn, duplicate items after a terminal snapshot, or move the reader when older content is prepended. Structural tests must cover all three.

## Review units

| Review | Deliverable | Acceptance |
|---|---|---|
| 7A | remove redundant catalog/session reads from the existing switch path | catalog construction parses each Session once; Loaded-to-Loaded switching performs one post-start catalog refresh rather than a refresh before and after start; existing lifecycle/failure tests remain green |
| 7B | complete-Turn history page contract and `Load earlier messages` UI | initial wire snapshot is bounded to the latest 30 complete Turns; `load_session_history(session_id, before_turn, limit)` returns older complete Turns and `has_older`; projection merges by stable item identity; prepend preserves scroll; retry is visible; no virtual list is added |

## Validation

- Focused Rust tests for SessionQuery paging/catalog reads, protocol serialization, runtime command routing, and lifecycle failures.
- Shared Rust/TypeScript fixtures for the new command/response shapes.
- Focused Controller/projection/App tests for one refresh per switch, stale Session rejection, duplicate-free prepend, loading/error state, and focus/scroll stability.
- `pnpm test`, `pnpm run check`, `pnpm run build`, `git diff --check`, then `just check` outside the sandbox if localhost test binding requires it.
- Independent Standards / Spec review after each review unit; no commit without user review.

## Stop conditions

- Paging requires changing the canonical Session Item Log format or Agent model input.
- A UI-only selected Session would be presented as Host-loaded before runtime activation.
- Complete-Turn boundaries cannot be expressed from current persisted `SessionItem.base.turn`.
- The review unit exceeds the batch diff budget without a documented split.

## Outcome — 2026-09-02

- **7A implemented:** catalog projection parses, projects, and drops one Session Item Log at a time, and Loaded-to-Loaded switching performs one catalog refresh after the target Session is established.
- **7B implemented:** initial snapshots deliver at most the latest 30 whole Turns; `load_session_history` uses an exclusive `before_turn` cursor and a bounded `1..=100` limit; the UI exposes `Load earlier messages`, a visible pending/error state, retry, duplicate-free prepend, and scroll-anchor preservation.
- **Concurrency:** history paging is single-flight and blocks Session lifecycle changes until the request settles. Responses for another Session cannot change the loaded projection.
- **Runtime responsiveness:** full-file history reads run on a blocking worker outside the coordinator mutex; a response is discarded if its runtime epoch was replaced while reading.
- **Window provenance:** rolling latest snapshots replace the default 30-Turn window. Only an explicit older-page response marks the window expanded and causes later snapshots to preserve those older immutable items.
- **Virtualization decision:** no virtual list was added. The current DOM window begins at 30 Turns and grows only by explicit user intent; variable-height virtualization remains measurement-gated.
- **Known limitation:** `SessionQuery` still parses the full JSONL file to derive each page because the v0.1 Session Item Log has no reverse index. This batch bounds wire payload and WebView work; it does not claim bounded disk reads. Adding an index or changing persistence remains out of scope until measurement proves the need.
- **Validation:** frontend `103/103` tests, `svelte-check` with zero warnings/errors, production build, shared Rust/TypeScript history fixture, focused paging/runtime tests, `git diff --check`, and sandbox-external `just check` all pass with `/Users/chenjiayu/.cargo/bin/rustc`.
- **Review:** independent Standards / Spec review reports no remaining P0/P1/P2. User diff review and commit remain separate gates.
