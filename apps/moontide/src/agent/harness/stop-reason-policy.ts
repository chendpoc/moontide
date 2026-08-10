import type { LLMResponse } from "@moontide/llm/protocol";

export type StopReasonPolicyResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

/** Harness policy for typed LLMStopReason — max_tokens is not silent success. */
export function validateLlmStopReason(response: LLMResponse): StopReasonPolicyResult {
  switch (response.stopReason) {
    case "end_turn":
      return { ok: true };
    case "tool_use": {
      const hasToolUse = response.content.some((block) => block.type === "tool_use");
      if (!hasToolUse) {
        return {
          ok: false,
          errorMessage: "LLM stopReason tool_use but response has no tool_use blocks",
        };
      }
      return { ok: true };
    }
    case "max_tokens":
      return { ok: false, errorMessage: "LLM response incomplete (max_tokens)" };
    case "content_filter":
      return { ok: false, errorMessage: "LLM response blocked (content_filter)" };
    case "provider_error":
      return { ok: false, errorMessage: "LLM provider error" };
    default: {
      const _exhaustive: never = response.stopReason;
      return _exhaustive;
    }
  }
}
