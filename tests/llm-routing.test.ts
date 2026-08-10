import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRoute } from "@moontide/llm";
import { adapterChat } from "../packages/llm/src/adapters/index.js";

describe("llm routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to deepseek openai-chat-completions when DEEPSEEK_API_KEY is set", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");

    const route = resolveRoute();
    expect(route.providerPresetId).toBe("deepseek");
    expect(route.vendorModelId).toBe("deepseek-v4-pro");
    expect(route.adapterFamily).toBe("openai-chat-completions");
  });

  it("throws for unknown MOONTIDE_PROVIDER", () => {
    vi.stubEnv("MOONTIDE_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");

    expect(() => resolveRoute()).toThrow(/Unknown provider preset: anthropic/);
  });

  it("throws when no provider API key is configured", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => resolveRoute()).toThrow(/DEEPSEEK_API_KEY/);
  });

  it("throws when explicit preset lacks API key", () => {
    vi.stubEnv("MOONTIDE_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => resolveRoute()).toThrow(/DEEPSEEK_API_KEY/);
  });

  it("uses openai-chat-completions for json_object judge route", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");

    const agent = resolveRoute("deepseek-v4-flash");
    expect(agent.adapterFamily).toBe("openai-chat-completions");

    const judge = resolveRoute("deepseek-v4-flash", { jsonObject: true });
    expect(judge.adapterFamily).toBe("openai-chat-completions");
    expect(judge.providerPresetId).toBe("deepseek");
  });

  it("honors MOONTIDE_ADAPTER_FAMILY when allowed on model route", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MOONTIDE_ADAPTER_FAMILY", "openai-responses");
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");

    const route = resolveRoute("deepseek-v4-flash");
    expect(route.adapterFamily).toBe("openai-responses");
  });

  it("rejects MOONTIDE_ADAPTER_FAMILY when not on model route allowlist", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MOONTIDE_ADAPTER_FAMILY", "openai-responses");
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");

    expect(() => resolveRoute("deepseek-v4-pro")).toThrow(/not allowed/);
  });

  it("bumps thinking to high in deep mode when model supports thinking", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");

    const normal = resolveRoute("deepseek-v4-pro");
    const deep = resolveRoute("deepseek-v4-pro", { deepMode: true });
    expect(normal.thinkingLevel).toBe("medium");
    expect(deep.thinkingLevel).toBe("high");
  });

  it("adapterChat rejects pro model on openai-responses route", async () => {
    await expect(
      adapterChat(
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
});
