import { afterEach, describe, expect, it, vi } from "vitest";

import { adapterCountTokens } from "../packages/llm/src/adapters/index.js";
import {
  getCountTokensSupportCache,
  resetCountTokensSupportCache,
} from "../packages/llm/src/adapters/count-tokens-support.js";
import { deepseekCountTokens } from "../packages/llm/src/adapters/deepseek-count-tokens.js";

describe("deepseek count_tokens contract", () => {
  afterEach(() => {
    resetCountTokensSupportCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("adapterCountTokens throws count_tokens_unsupported for non-deepseek preset", async () => {
    await expect(
      adapterCountTokens(
        {
          model: "other",
          system: "",
          messages: [{ role: "user", content: "hi" }],
          tools: [],
          maxTokens: 1,
        },
        {
          logicalModelId: "other",
          providerPresetId: "unknown",
          vendorModelId: "other",
          adapterFamily: "openai-chat-completions",
          thinkingLevel: "off",
        },
      ),
    ).rejects.toMatchObject({
      context: { reason: "count_tokens_unsupported" },
    });
  });

  it("deepseekCountTokens calls anthropic-compatible endpoint and returns input_tokens", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    resetCountTokensSupportCache();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/messages/count_tokens")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const messages = body.messages as Array<{ content?: string }> | undefined;
        if (messages?.[0]?.content === "ping") {
          return new Response(JSON.stringify({ input_tokens: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        expect(body.model).toBe("deepseek-v4-flash");
        expect(body.system).toBe("sys");
        expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
        return new Response(JSON.stringify({ input_tokens: 42 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const count = await deepseekCountTokens(
      {
        model: "deepseek-v4-flash",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 1,
      },
      {
        logicalModelId: "deepseek-v4-flash",
        providerPresetId: "deepseek",
        vendorModelId: "deepseek-v4-flash",
        adapterFamily: "openai-chat-completions",
        thinkingLevel: "off",
      },
    );

    expect(count).toBe(42);
    expect(getCountTokensSupportCache()).toBe("supported");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("marks unsupported when preflight probe fails", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    resetCountTokensSupportCache();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );

    await expect(
      deepseekCountTokens(
        {
          model: "deepseek-v4-flash",
          system: "",
          messages: [{ role: "user", content: "hi" }],
          tools: [],
          maxTokens: 1,
        },
        {
          logicalModelId: "deepseek-v4-flash",
          providerPresetId: "deepseek",
          vendorModelId: "deepseek-v4-flash",
          adapterFamily: "openai-chat-completions",
          thinkingLevel: "off",
        },
      ),
    ).rejects.toMatchObject({
      context: { reason: "count_tokens_unsupported" },
    });
    expect(getCountTokensSupportCache()).toBe("unsupported");
  });
});
