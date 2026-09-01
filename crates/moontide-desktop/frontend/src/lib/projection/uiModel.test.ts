import { describe, expect, it } from "vitest";

import { createRenderState } from "$lib/projection/renderState.js";
import {
  blocksText,
  chatUiModel,
  composerMode,
  conversationItems,
  liveTools,
  sessionListModel,
  snapshotText,
  toolResultContentText,
  toolStatusLabel,
  toolStatusModel,
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

  it("hides thinking while preserving visible text and pending streaming content", () => {
    expect(
      blocksText([
        { kind: "thinking", thinking: "private" },
        { kind: "text", text: "answer" },
        { kind: "tool_use", id: "call-1", name: "grep", input: {} },
      ]),
    ).toBe("answer\ntool: grep");
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
    ).toBe("Failed · retryable");
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
    ).toEqual({ label: "Cancelled · user", tone: "warning" });
    expect(
      toolResultContentText({
        ...base,
        status: "succeeded",
        content: { json: { ok: true } },
      }),
    ).toBe('{\n  "ok": true\n}');
  });
});
