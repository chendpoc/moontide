import { afterEach, describe, expect, it } from "vitest";

import {
  resetCountTokensSupportCache,
  resolveCountTokensSupport,
} from "../packages/llm/src/adapters/count-tokens-support.js";

const hasLiveKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
const liveLlmEnabled = process.env.MOONTIDE_LIVE_LLM === "1";

describe("deepseek count_tokens live preflight", () => {
  afterEach(() => {
    resetCountTokensSupportCache();
  });

  it.skipIf(!hasLiveKey || !liveLlmEnabled)(
    "probes DeepSeek anthropic count_tokens endpoint",
    async () => {
      const support = await resolveCountTokensSupport({
        logicalModelId: "deepseek-v4-flash",
        providerPresetId: "deepseek",
        vendorModelId: "deepseek-v4-flash",
        adapterFamily: "openai-chat-completions",
        thinkingLevel: "off",
      });
      expect(support).toBe("supported");
    },
  );
});
