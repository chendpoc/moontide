import { describe, expect, it } from "vitest";

import { resolveToolChoice } from "../packages/llm/src/protocol/types.js";
import { mapAnthropicStopReason, mapOpenAiFinishReason } from "../packages/llm/src/normalize/finish-reason.js";

describe("llm protocol", () => {
  it("resolveToolChoice defaults to auto when tools are present", () => {
    expect(
      resolveToolChoice({
        tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
      }),
    ).toEqual({ mode: "auto" });
  });

  it("resolveToolChoice returns undefined when no tools and no explicit choice", () => {
    expect(resolveToolChoice({ tools: [] })).toBeUndefined();
  });

  it("resolveToolChoice preserves explicit none", () => {
    expect(
      resolveToolChoice({
        tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
        toolChoice: { mode: "none" },
      }),
    ).toEqual({ mode: "none" });
  });

  it("mapOpenAiFinishReason maps vendor values", () => {
    expect(mapOpenAiFinishReason("stop")).toBe("end_turn");
    expect(mapOpenAiFinishReason("tool_calls")).toBe("tool_use");
    expect(mapOpenAiFinishReason("length")).toBe("max_tokens");
  });

  it("mapOpenAiFinishReason throws on unknown finish_reason", () => {
    expect(() => mapOpenAiFinishReason("mystery")).toThrow(/Unknown LLM finish_reason/);
  });

  it("mapAnthropicStopReason maps vendor values", () => {
    expect(mapAnthropicStopReason("end_turn")).toBe("end_turn");
    expect(mapAnthropicStopReason("tool_use")).toBe("tool_use");
  });
});
