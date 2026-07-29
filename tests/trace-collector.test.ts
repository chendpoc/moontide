import { describe, expect, it } from "vitest";

import {
  collectFromResponse,
  collectFromToolResult,
} from "../src/plugins/trace/collector.js";

describe("trace collector", () => {
  it("extracts thinking, text, and tool_use from response content", () => {
    const drafts = collectFromResponse(
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan", signature: "sig" },
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "tu_1", name: "read_file", input: { path: "a.ts" } },
        ],
        model: "deepseek-v4-pro",
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      2,
    );

    expect(drafts.map((d) => d.kind)).toEqual(["thinking", "assistant_text", "tool_use"]);
    expect(drafts[0]?.payload.body).toBe("plan");
    expect(drafts[2]?.payload.toolName).toBe("read_file");
  });

  it("collects tool_result with body and preview", () => {
    const drafts = collectFromToolResult({
      turn: 2,
      tool_name: "read_file",
      tool_use_id: "tu_1",
      output: "file contents",
    });
    expect(drafts[0]?.kind).toBe("tool_result");
    expect(drafts[0]?.payload.body).toBe("file contents");
    expect(drafts[0]?.preview).toContain("file contents");
  });
});
