import { describe, expect, it } from "vitest";

import { createRenderState } from "./renderState";
import {
  blocksText,
  composerMode,
  liveTools,
  snapshotText,
  toolStatusLabel,
} from "./uiModel";

describe("desktop UI presentation model", () => {
  it("keeps composer authority aligned with connection and run state", () => {
    expect(composerMode({ kind: "ready" }, "idle", "idle")).toBe("editable");
    expect(
      composerMode({ kind: "ready" }, { thinking: { turn: 1, step: 0 } }, "idle"),
    ).toBe("active");
    expect(composerMode({ kind: "ready" }, "idle", "submitting")).toBe("submitting");
    expect(
      composerMode({ kind: "ready" }, { cancelling: { turn: 1 } }, "idle"),
    ).toBe("cancelling");
    expect(composerMode({ kind: "disconnected", message: "closed" }, "idle", "idle")).toBe(
      "disabled",
    );
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

  it("shows only live tools outside the historical message sequence", () => {
    const state = createRenderState();
    const historical = { tool_use_id: "tool-1", name: "read", input: {} };
    const live = { tool_use_id: "tool-2", name: "grep", input: {} };
    state.messages.push({ kind: "tool_call", turn: 1, call: historical });
    state.tools[historical.tool_use_id] = { turn: 1, call: historical, result: null };
    state.tools[live.tool_use_id] = { turn: 1, call: live, result: null };

    expect(liveTools(state).map((tool) => tool.call.tool_use_id)).toEqual(["tool-2"]);
    expect(toolStatusLabel(null)).toBe("running");
    expect(
      toolStatusLabel({
        tool_use_id: "tool-2",
        name: "grep",
        status: { failed: { retryable: true } },
        content: { text: "failed" },
      }),
    ).toBe("failed · retryable");
  });
});
