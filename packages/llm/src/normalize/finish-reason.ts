import { infraError } from "@moontide/shared/errors/factories.js";

import type { LLMStopReason } from "../protocol/types.js";

const OPENAI_FINISH_REASON_MAP: Record<string, LLMStopReason> = {
  stop: "end_turn",
  tool_calls: "tool_use",
  length: "max_tokens",
  content_filter: "content_filter",
  insufficient_system_resource: "provider_error",
};

const ANTHROPIC_STOP_REASON_MAP: Record<string, LLMStopReason> = {
  end_turn: "end_turn",
  stop_sequence: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  pause_turn: "end_turn",
};

/** Map OpenAI Chat Completions `finish_reason` to MoonTide stop reason. */
export function mapOpenAiFinishReason(raw: string | null | undefined): LLMStopReason {
  if (!raw) {
    throw infraError("LLM response missing finish_reason", {
      context: { reason: "llm_malformed_response" },
    });
  }
  const mapped = OPENAI_FINISH_REASON_MAP[raw];
  if (!mapped) {
    throw infraError(`Unknown LLM finish_reason: ${raw}`, {
      context: { reason: "llm_malformed_response", finishReason: raw },
    });
  }
  return mapped;
}

/** Map Anthropic Messages `stop_reason` to MoonTide stop reason. */
export function mapAnthropicStopReason(raw: string | null | undefined): LLMStopReason {
  if (!raw) {
    throw infraError("LLM response missing stop_reason", {
      context: { reason: "llm_malformed_response" },
    });
  }
  const mapped = ANTHROPIC_STOP_REASON_MAP[raw];
  if (!mapped) {
    throw infraError(`Unknown LLM stop_reason: ${raw}`, {
      context: { reason: "llm_malformed_response", stopReason: raw },
    });
  }
  return mapped;
}
