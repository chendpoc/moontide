import { setLLMProvider, type LLMProvider } from "@moontide/llm";
import type { LLMRequest, LLMResponse } from "@moontide/llm/protocol";

const MOCK_L1_ENV = "MOONTIDE_EVAL_L1";

function _mockResponse(_request: LLMRequest): LLMResponse {
  return {
    content: [{ type: "text", text: "mock L1 eval reply" }],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 2 },
  };
}

const MOCK_PROVIDER: LLMProvider = {
  chat: async (request) => _mockResponse(request),
  countTokens: async () => 1,
};

export function isEvalL1Mode(): boolean {
  const raw = process.env[MOCK_L1_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** Install mock LLM for L1 eval runs (no API key). Returns teardown. */
export function installEvalMockLlm(): () => void {
  setLLMProvider(MOCK_PROVIDER);
  return () => setLLMProvider(undefined);
}
