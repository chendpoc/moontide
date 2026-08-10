import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRoute, runLLM, setLLMProvider } from "../packages/llm/src/index.js";
import type { LLMProvider } from "../packages/llm/src/provider.js";

describe("runLLM resolvedRequest observation", () => {
  afterEach(() => {
    setLLMProvider(undefined);
    vi.unstubAllEnvs();
  });

  it("records vendor model id and thinking level in LLMCallRecord.request", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");

    let capturedRequest: Parameters<LLMProvider["chat"]>[0] | undefined;
    const records: Array<{ request: { model: string; thinkingLevel?: string } }> = [];

    setLLMProvider({
      chat: async (request) => {
        capturedRequest = request;
        return {
          content: [{ type: "text", text: "ok" }],
          stopReason: "end_turn",
        };
      },
    });

    await runLLM({
      turn: 1,
      model: "deepseek-v4-flash",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxTokens: 100,
      onLLMCall: (record) => {
        records.push(record);
      },
    });

    expect(capturedRequest?.model).toBe("deepseek-v4-flash");
    expect(records[0]?.request.model).toBe("deepseek-v4-flash");
    expect(records[0]?.request).toBe(capturedRequest);
  });

  it("re-throws AbortError instead of recording failed outcome", async () => {
    const controller = new AbortController();
    controller.abort();

    setLLMProvider({
      chat: async () => ({
        content: [{ type: "text", text: "ok" }],
        stopReason: "end_turn",
      }),
    });

    await expect(
      runLLM({
        turn: 1,
        model: "deepseek-v4-flash",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 100,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("re-throws provider AbortError", async () => {
    setLLMProvider({
      chat: async () => {
        throw new DOMException("Aborted", "AbortError");
      },
    });

    await expect(
      runLLM({
        turn: 1,
        model: "deepseek-v4-flash",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        maxTokens: 100,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("forces openai-chat-completions routing for json_object even when adapter override is responses", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MOONTIDE_ADAPTER_FAMILY", "openai-responses");
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");

    expect(resolveRoute("deepseek-v4-flash").adapterFamily).toBe("openai-responses");

    setLLMProvider({
      chat: async () => ({
        content: [{ type: "text", text: "{}" }],
        stopReason: "end_turn",
      }),
    });

    let recordedAdapterFamily: string | undefined;
    await runLLM({
      turn: 1,
      model: "deepseek-v4-flash",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxTokens: 100,
      responseFormat: "json_object",
      onLLMCall: (record) => {
        recordedAdapterFamily = record.routing.adapterFamily;
      },
    });

    expect(recordedAdapterFamily).toBe("openai-chat-completions");
  });
});
