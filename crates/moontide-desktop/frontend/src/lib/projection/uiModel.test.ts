import { describe, expect, it } from "vitest";

import { createRenderState } from "$lib/projection/renderState.js";
import {
  actionErrorCopy,
  allowsApproval,
  allowsSessionTransition,
  blocksText,
  catalogErrorCopy,
  chatUiModel,
  composerAlertPresentation,
  composerMode,
  connectionAnnouncement,
  connectionPresentation,
  contentBlockDisplayText,
  conversationItems,
  historyErrorCopy,
  historyLoadBlockReason,
  historyLoadReason,
  isSessionCloseSettled,
  liveAnnouncementPresentation,
  liveTools,
  noticePresentation,
  sessionExcerptLabel,
  sessionListModel,
  sessionTransitionBlockReason,
  sessionTransitionReason,
  snapshotText,
  toolResultContentText,
  toolStatusLabel,
  toolStatusModel,
  visibleConversationNotices,
} from "$lib/projection/uiModel.js";

describe("desktop UI presentation model", () => {
  it("keeps composer authority aligned with connection and run state", () => {
    expect(composerMode({ kind: "ready" }, "loaded", "idle", "idle")).toBe("editable");
    expect(
      composerMode(
        { kind: "ready" },
        "loaded",
        { thinking: { turn: 1, step: 0 } },
        "idle",
      ),
    ).toBe("active");
    expect(composerMode({ kind: "ready" }, "loaded", "idle", "submitting")).toBe(
      "submitting",
    );
    expect(
      composerMode(
        { kind: "ready" },
        "loaded",
        { cancelling: { turn: 1 } },
        "idle",
      ),
    ).toBe("cancelling");
    expect(
      composerMode(
        { kind: "disconnected", message: "closed" },
        "loaded",
        "idle",
        "idle",
      ),
    ).toBe("disabled");
    expect(composerMode({ kind: "ready" }, "blank", "starting", "idle")).toBe(
      "editable",
    );
  });

  // Approval controls must stay actionable while local submit phase is still settling;
  // only an in-flight approve/deny or cancel should lock them.
  it("allows approval while submit phase is still settling", () => {
    const waiting = {
      waiting_approval: { turn: 1, request_id: "approval-1" },
    } as const;
    expect(allowsApproval({ kind: "ready" }, waiting, "idle")).toBe(true);
    expect(allowsApproval({ kind: "ready" }, waiting, "submitting")).toBe(true);
    expect(allowsApproval({ kind: "ready" }, "idle", "submitting", 1)).toBe(true);
    expect(allowsApproval({ kind: "ready" }, waiting, "approval")).toBe(false);
    expect(allowsApproval({ kind: "ready" }, waiting, "cancelling")).toBe(false);
    expect(
      allowsApproval({ kind: "disconnected", message: "closed" }, waiting, "idle"),
    ).toBe(false);
  });

  it("derives Blank and Loaded only from canonical Session identity", () => {
    const state = createRenderState();
    state.messages.push({ kind: "user", turn: 1, text: "orphan projection" });
    expect(chatUiModel(state)).toEqual({ page: "blank", sessionId: null });

    state.messages = [];
    state.session = {
      summary: {
        session_id: "session-empty",
        cwd: ".",
        last_turn: null,
        item_count: 0,
      },
      items: [],
      history: { oldest_turn: null, has_older: false },
    };
    expect(chatUiModel(state)).toEqual({
      page: "loaded",
      sessionId: "session-empty",
    });
  });

  it("preserves Host catalog order and loaded flags in the Session list model", () => {
    expect(
      sessionListModel({
        kind: "ready",
        rows: [
          {
            session_id: "session-2",
            first_user_message_excerpt: "newer",
            last_activity_at: "2026-09-01T10:00:00Z",
            loaded: true,
          },
          {
            session_id: "session-1",
            first_user_message_excerpt: null,
            last_activity_at: null,
            loaded: false,
          },
        ],
      }),
    ).toEqual({
      status: "ready",
      rows: [
        {
          sessionId: "session-2",
          excerpt: "newer",
          lastActivityAt: "2026-09-01T10:00:00Z",
          selected: true,
        },
        {
          sessionId: "session-1",
          excerpt: null,
          lastActivityAt: null,
          selected: false,
        },
      ],
      error: null,
    });
  });

  // Session-changing controls share one explanation derived from authoritative lifecycle facts;
  // safe idle/failed/starting states remain actionable and every unsafe category stays distinguishable.
  it("explains why Session transitions are blocked", () => {
    const render = createRenderState();
    render.run = "idle";
    const view = {
      connection: { kind: "ready" as const },
      catalog: { kind: "empty" as const, rows: [] as [] },
      firstSend: { kind: "idle" as const },
      render,
    };
    expect(sessionTransitionBlockReason(view)).toBeNull();
    expect(allowsSessionTransition(view)).toBe(true);

    render.run = "starting";
    expect(sessionTransitionBlockReason(view)).toBeNull();

    render.run = { thinking: { turn: 1, step: 0 } };
    expect(sessionTransitionBlockReason(view)).toBe(
      "Finish or stop the current turn before changing Sessions.",
    );

    render.run = { waiting_approval: { turn: 1, request_id: "approval-1" } };
    expect(sessionTransitionBlockReason(view)).toBe(
      "Resolve the pending approval before changing Sessions.",
    );

    render.run = "idle";
    render.delivery.awaitingSnapshot = true;
    expect(sessionTransitionBlockReason(view)).toBe(
      "Wait for MoonTide to finish syncing before changing Sessions.",
    );
  });

  // UI-local overlay rules take precedence over Host lifecycle gates without changing Host copy.
  it("applies overlay rules before Host lifecycle gates for Session and history actions", () => {
    const render = createRenderState();
    render.run = "idle";
    const view = {
      connection: { kind: "ready" as const },
      catalog: { kind: "empty" as const, rows: [] as [] },
      firstSend: { kind: "idle" as const },
      render,
    };
    const idleOverlay = {
      historyLoading: false,
      lifecycleTarget: null,
      phase: "idle" as const,
    };

    expect(sessionTransitionReason(view, idleOverlay)).toBeNull();
    expect(historyLoadReason(view, idleOverlay)).toBeNull();

    expect(
      sessionTransitionReason(view, { ...idleOverlay, historyLoading: true }),
    ).toBe("Wait for earlier messages to finish loading before changing Sessions.");

    expect(
      sessionTransitionReason(view, { ...idleOverlay, lifecycleTarget: "session-1" }),
    ).toBe("A Session change is already in progress.");

    expect(
      sessionTransitionReason(view, { ...idleOverlay, phase: "submitting" }),
    ).toBe("Wait for the current action to finish before switching Sessions.");

    render.run = { thinking: { turn: 1, step: 0 } };
    expect(
      sessionTransitionReason(view, { ...idleOverlay, phase: "submitting" }),
    ).toBe("Wait for the current action to finish before switching Sessions.");
    expect(sessionTransitionReason(view, idleOverlay)).toBe(
      "Finish or stop the current turn before changing Sessions.",
    );

    render.run = "idle";
    expect(
      historyLoadReason(view, { ...idleOverlay, lifecycleTarget: "session-1" }),
    ).toBe("Wait for the Session change to finish before loading earlier messages.");
    expect(
      historyLoadReason(view, { ...idleOverlay, phase: "approval" }),
    ).toBe("Wait for the current action to finish before loading earlier messages.");
  });

  it("maps connection announcements and composer alert presentation", () => {
    expect(connectionAnnouncement("starting")).toBe("MoonTide is starting");
    expect(connectionAnnouncement("ready")).toBe("MoonTide is ready");
    expect(connectionAnnouncement("disconnected")).toBe("MoonTide connection unavailable");
    expect(composerAlertPresentation("starting")).toEqual({
      title: "Starting MoonTide",
      description: "Sending will be available shortly.",
    });
    expect(composerAlertPresentation("action_failed")).toEqual({
      title: "Action failed",
      description: "",
    });
  });

  it("maps live approval announcements for screen readers", () => {
    expect(
      liveAnnouncementPresentation({
        id: "1:1:approval-1",
        kind: "approval_required",
        toolName: "bash",
      }),
    ).toBe("Approval required for bash");
  });

  // Close gate shares lifecycle settled facts with uiModel and rejects in-flight submission separately.
  it("requires a settled Session before close using shared lifecycle facts", () => {
    const render = createRenderState();
    render.run = "idle";
    const view = {
      connection: { kind: "ready" as const },
      catalog: { kind: "empty" as const, rows: [] as [] },
      firstSend: { kind: "idle" as const },
      render,
    };
    expect(isSessionCloseSettled(view)).toBe(true);
    expect(isSessionCloseSettled(view, { turnSubmissionPending: true })).toBe(false);

    render.run = { thinking: { turn: 1, step: 0 } };
    expect(isSessionCloseSettled(view)).toBe(false);
  });

  it("explains why earlier history cannot load while Session facts are unsettled", () => {
    const render = createRenderState();
    render.run = "idle";
    const view = {
      connection: { kind: "ready" as const },
      catalog: { kind: "empty" as const, rows: [] as [] },
      firstSend: { kind: "idle" as const },
      render,
    };
    expect(historyLoadBlockReason(view)).toBeNull();

    render.run = { thinking: { turn: 1, step: 0 } };
    expect(historyLoadBlockReason(view)).toBe(
      "Finish or stop the current turn before loading earlier messages.",
    );

    render.run = { waiting_approval: { turn: 1, request_id: "approval-1" } };
    expect(historyLoadBlockReason(view)).toBe(
      "Resolve the pending approval before loading earlier messages.",
    );

    render.run = "idle";
    render.delivery.resyncRequired = true;
    expect(historyLoadBlockReason(view)).toBe(
      "Wait for MoonTide to finish syncing before loading earlier messages.",
    );
  });

  // Completed snapshot cleanup is not chat copy. Only in-flight delivery resync reaches the
  // reading surface, and it uses a recovery sentence instead of protocol reason codes.
  it("keeps completed resync cleanup off the conversation surface", () => {
    const render = createRenderState();
    render.notices = [
      {
        kind: "resync",
        message: "resync removed an assistant draft whose call was no longer active",
        recoverable: true,
        errorKind: null,
      },
      {
        kind: "error",
        message: "provider unavailable",
        recoverable: true,
        errorKind: "provider",
      },
    ];

    expect(visibleConversationNotices(render)).toEqual([render.notices[1]]);

    render.delivery.resyncRequired = true;
    expect(visibleConversationNotices(render)).toEqual(render.notices);
    expect(noticePresentation(render.notices[0]!)).toEqual({
      title: "Updating conversation",
      description: "Live updates were interrupted. Restoring the latest state.",
    });
  });

  // Disconnected delivery hides resync notices so connection loss does not stack with recovery copy.
  it("hides resync notices while the connection is unavailable", () => {
    const render = createRenderState();
    render.delivery.resyncRequired = true;
    render.notices = [
      {
        kind: "resync",
        message: "desktop state requires resync: event_gap",
        recoverable: true,
        errorKind: null,
      },
    ];

    expect(visibleConversationNotices(render, { kind: "ready" })).toEqual(render.notices);
    expect(visibleConversationNotices(render, { kind: "disconnected", message: "closed" })).toEqual(
      [],
    );
    expect(visibleConversationNotices(render, { kind: "degraded", message: "degraded" })).toEqual([]);
  });

  // Host and Controller strings stay in state; presentation maps them to user-facing copy.
  it("maps connection, catalog, history, action, and notice failures for the chat surface", () => {
    expect(connectionPresentation({ kind: "disconnected", message: "event stream closed" })).toEqual({
      title: "Connection lost",
      description: "MoonTide disconnected. Retry to continue.",
    });
    expect(connectionPresentation({ kind: "degraded", message: "snapshot unavailable" })).toEqual({
      title: "Connection lost",
      description: "MoonTide disconnected. Retry to continue.",
    });
    expect(catalogErrorCopy("desktop session catalog is unavailable")).toBe(
      "Couldn't load recent conversations.",
    );
    expect(historyErrorCopy("Desktop history page does not match")).toBe(
      "Couldn't load earlier messages.",
    );
    expect(actionErrorCopy("Desktop Session creation baseline still requires resync")).toBe(
      "That action didn't complete. Try again.",
    );
    expect(sessionExcerptLabel(null)).toBe("Untitled session");
    expect(
      noticePresentation({
        kind: "stopped",
        message: "desktop host stopped",
        recoverable: false,
        errorKind: null,
      }),
    ).toEqual({
      title: "MoonTide stopped",
      description: "This window is no longer connected.",
    });
    expect(
      noticePresentation({
        kind: "error",
        message: "desktop host is busy",
        recoverable: true,
        errorKind: null,
      }),
    ).toEqual({
      title: "Reply didn't finish",
      description: "The reply didn't finish. Try again.",
    });
    expect(
      noticePresentation({
        kind: "error",
        message: "HTTP 402 Payment Required",
        recoverable: true,
        errorKind: "provider",
      }).description,
    ).toBe("HTTP 402 Payment Required");
    expect(
      noticePresentation({
        kind: "error",
        message: "bash exited 1",
        recoverable: true,
        errorKind: "tool",
      }).description,
    ).toBe("bash exited 1");
    expect(
      noticePresentation({
        kind: "error",
        message: "internal coordinator panic",
        recoverable: false,
        errorKind: "internal",
      }),
    ).toEqual({
      title: "Reply didn't finish",
      description: "The reply didn't finish. Try again.",
    });
  });

  it("hides thinking while preserving visible text and pending streaming content", () => {
    expect(
      blocksText([
        { kind: "thinking", thinking: "private" },
        { kind: "text", text: "answer" },
        { kind: "tool_use", id: "call-1", name: "grep", input: {} },
      ]),
    ).toBe("answer\ntool: grep");
    expect(
      contentBlockDisplayText([
        { kind: "tool_result", tool_use_id: "call-1", content: "done" },
      ]),
    ).toBe("done");
    expect(
      contentBlockDisplayText([
        {
          kind: "tool_result",
          tool_use_id: "call-1",
          content: [{ kind: "text", text: "nested" }],
        },
      ]),
    ).toBe("nested");
    expect(
      snapshotText({
        content: [{ kind: "text", text: "hel" }],
        pending: { kind: "text", text: "lo" },
        stop_reason: null,
        usage: null,
        model: null,
      }),
    ).toBe("hel\nlo");
  });

  // Live ToolViews exclude identities already materialized in history and retain the Controller's
  // insertion order even when opaque tool IDs would sort differently.
  it("shows only live tools outside the historical message sequence", () => {
    const state = createRenderState();
    const historical = { tool_use_id: "tool-1", name: "read", input: {} };
    const firstLive = { tool_use_id: "tool-z", name: "grep", input: {} };
    const secondLive = { tool_use_id: "tool-a", name: "bash", input: {} };
    state.messages.push({ kind: "tool_call", turn: 1, call: historical });
    state.tools[historical.tool_use_id] = { turn: 1, call: historical, result: null };
    state.tools[firstLive.tool_use_id] = { turn: 1, call: firstLive, result: null };
    state.tools[secondLive.tool_use_id] = { turn: 1, call: secondLive, result: null };

    expect(liveTools(state).map((tool) => tool.call.tool_use_id)).toEqual([
      "tool-z",
      "tool-a",
    ]);
    expect(toolStatusLabel(null)).toBe("Running");
    expect(
      toolStatusLabel({
        tool_use_id: "tool-z",
        name: "grep",
        status: { failed: { retryable: true } },
        content: { text: "failed" },
      }),
    ).toBe("Failed");
  });

  it("pairs historical ToolCall and ToolResult without changing message order", () => {
    const state = createRenderState();
    const call = { tool_use_id: "tool-1", name: "read", input: { path: "README.md" } };
    const result = {
      tool_use_id: "tool-1",
      name: "read",
      status: "succeeded" as const,
      content: { text: "MoonTide" },
    };
    state.messages = [
      { kind: "user", turn: 1, text: "Read it" },
      { kind: "tool_call", turn: 1, call },
      { kind: "tool_result", turn: 1, result },
      { kind: "assistant", turn: 1, blocks: [{ kind: "text", text: "Done" }] },
    ];

    expect(conversationItems(state)).toEqual([
      { kind: "user", key: "user:1:0", turn: 1, text: "Read it" },
      { kind: "tool", key: "tool:tool-1", turn: 1, call, result },
      {
        kind: "assistant",
        key: "assistant:1:3",
        turn: 1,
        blocks: [{ kind: "text", text: "Done" }],
      },
    ]);
  });

  it("keeps every Tool terminal outcome distinct and formats result content", () => {
    const base = {
      tool_use_id: "tool-1",
      name: "bash",
      content: { text: "output" },
    };
    const cases = [
      ["succeeded", "Succeeded", "success"],
      ["invalid_arguments", "Invalid arguments", "danger"],
      ["unknown_tool", "Unknown tool", "danger"],
      ["denied", "Denied", "warning"],
      ["outcome_unknown", "Execution outcome unknown", "warning"],
    ] as const;

    for (const [status, label, tone] of cases) {
      expect(toolStatusModel({ ...base, status })).toEqual({ label, tone });
    }
    expect(toolStatusModel({ ...base, status: { failed: { retryable: false } } })).toEqual({
      label: "Failed",
      tone: "danger",
    });
    expect(
      toolStatusModel({ ...base, status: { cancelled: { reason: "user" } } }),
    ).toEqual({ label: "Cancelled", tone: "warning" });
    expect(
      toolResultContentText({
        ...base,
        status: "succeeded",
        content: { json: { ok: true } },
      }),
    ).toBe('{\n  "ok": true\n}');
  });
});
