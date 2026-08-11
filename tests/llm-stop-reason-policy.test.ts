import { describe, expect, it } from "vitest";

import { validateLlmStopReason } from "../packages/agent/src/agent/harness/stop-reason-policy.js";
import type { LLMResponse } from "@moontide/llm/protocol";

function response(over: Partial<LLMResponse>): LLMResponse {
  return {
    content: [],
    stopReason: "end_turn",
    ...over,
  };
}

describe("validateLlmStopReason", () => {
  it("accepts end_turn", () => {
    expect(validateLlmStopReason(response({ stopReason: "end_turn" }))).toEqual({ ok: true });
  });

  it("accepts tool_use when tool_use blocks are present", () => {
    expect(
      validateLlmStopReason(
        response({
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "grep",
              input: { pattern: "x" },
            },
          ],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects tool_use without tool_use blocks", () => {
    const result = validateLlmStopReason(response({ stopReason: "tool_use" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain("tool_use");
    }
  });

  it("rejects max_tokens as incomplete", () => {
    const result = validateLlmStopReason(response({ stopReason: "max_tokens" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain("max_tokens");
    }
  });

  it("rejects content_filter", () => {
    const result = validateLlmStopReason(response({ stopReason: "content_filter" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain("content_filter");
    }
  });

  it("rejects provider_error", () => {
    const result = validateLlmStopReason(response({ stopReason: "provider_error" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain("provider");
    }
  });
});
