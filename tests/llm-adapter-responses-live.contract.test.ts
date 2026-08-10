import { afterEach, describe, expect, it, vi } from "vitest";

import { openAiResponses } from "../packages/llm/src/adapters/openai-responses.js";

const hasLiveKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
const liveLlmEnabled = process.env.MOONTIDE_LIVE_LLM === "1";

describe("openai-responses live contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.skipIf(!hasLiveKey || !liveLlmEnabled)(
    "completes flash model with reasoning.effort none",
    async () => {
      const response = await openAiResponses(
        {
          model: "deepseek-v4-flash",
          system: "Reply with one short word.",
          maxTokens: 32,
          thinkingLevel: "off",
          tools: [],
          messages: [{ role: "user", content: "Say hello." }],
        },
        {
          logicalModelId: "deepseek-v4-flash",
          providerPresetId: "deepseek",
          vendorModelId: "deepseek-v4-flash",
          adapterFamily: "openai-responses",
          thinkingLevel: "off",
        },
      );

      expect(response.stopReason).toBe("end_turn");
      expect(response.content.some((block) => block.type === "text")).toBe(true);
    },
  );
});
