import { afterEach, describe, expect, it, vi } from "vitest";

import { openAiResponses } from "../packages/llm/src/adapters/openai-responses.js";

describe("openai-responses contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends instructions/input/max_output_tokens and parses function_call output", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          model: "deepseek-v4-flash",
          output: [
            {
              type: "reasoning",
              content: [{ type: "reasoning_text", text: "need search" }],
            },
            {
              type: "function_call",
              call_id: "call_1",
              name: "grep",
              arguments: "{\"pattern\":\"MoonTide\"}",
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await openAiResponses(
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
        adapterFamily: "openai-responses",
        thinkingLevel: "off",
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/responses");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.instructions).toBe("sys");
    expect(body.input).toBe("find MoonTide");
    expect(body.max_output_tokens).toBe(128);
    expect(body.tool_choice).toBe("auto");
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "grep",
        description: "search",
        parameters: { type: "object" },
      },
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

  it("rejects non-flash models with responses_model_not_supported", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");

    await expect(
      openAiResponses(
        {
          model: "deepseek-v4-pro",
          system: "",
          messages: [{ role: "user", content: "hi" }],
          tools: [],
          maxTokens: 1,
        },
        {
          logicalModelId: "deepseek-v4-pro",
          providerPresetId: "deepseek",
          vendorModelId: "deepseek-v4-pro",
          adapterFamily: "openai-responses",
          thinkingLevel: "off",
        },
      ),
    ).rejects.toMatchObject({
      context: { reason: "responses_model_not_supported", model: "deepseek-v4-pro" },
    });
  });

  it("maps incomplete max_output_tokens to max_tokens stop reason", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          model: "deepseek-v4-flash",
          output: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await openAiResponses(
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
        adapterFamily: "openai-responses",
        thinkingLevel: "off",
      },
    );

    expect(response.stopReason).toBe("max_tokens");
  });
});
