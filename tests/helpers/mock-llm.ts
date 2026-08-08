import type { ContentBlock, LLMResponse } from "@moontide/llm/protocol";

export function mockLLMResponse(
  content: ContentBlock[],
  stopReason = "end_turn",
  usage = { inputTokens: 1, outputTokens: 1 },
): LLMResponse {
  return { content, stopReason, usage };
}

export function mockLLMProvider(chat: (...args: unknown[]) => Promise<LLMResponse>) {
  return {
    chat: chat as (request: unknown) => Promise<LLMResponse>,
    countTokens: async () => 42,
  };
}
