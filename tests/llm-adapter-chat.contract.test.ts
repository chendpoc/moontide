import { afterEach, describe, expect, it, vi } from "vitest";

import { openAiChatCompletions } from "../packages/llm/src/adapters/openai-chat-completions.js";

describe("openai-chat-completions contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends semantic request fields and parses tool_calls response", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek-v4-flash",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                reasoning_content: "need search",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "grep", arguments: "{\"pattern\":\"MoonTide\"}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await openAiChatCompletions(
      {
        model: "deepseek-v4-flash",
        system: "sys",
        maxTokens: 128,
        thinkingLevel: "off",
        toolChoice: { mode: "auto" },
        tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
        messages: [{ role: "user", content: "find MoonTide" }],
      },
      {
        logicalModelId: "deepseek-v4-flash",
        providerPresetId: "deepseek",
        vendorModelId: "deepseek-v4-flash",
        adapterFamily: "openai-chat-completions",
        thinkingLevel: "off",
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tool_choice).toBe("auto");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "find MoonTide" },
    ]);

    expect(response.stopReason).toBe("tool_use");
    expect(response.content).toEqual([
      { type: "thinking", thinking: "need search" },
      {
        type: "tool_use",
        id: "call_1",
        name: "grep",
        input: { pattern: "MoonTide" },
        argumentStatus: "ok",
      },
    ]);
  });
});
