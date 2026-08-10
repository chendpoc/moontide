import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRoute } from "@moontide/llm";

describe("llm routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to deepseek when only DEEPSEEK_API_KEY is set", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");

    const route = resolveRoute();
    expect(route.providerPresetId).toBe("deepseek");
    expect(route.vendorModelId).toBe("deepseek-v4-pro");
    expect(route.adapterFamily).toBe("anthropic-messages");
  });

  it("uses explicit MOONTIDE_PROVIDER when key is present", () => {
    vi.stubEnv("MOONTIDE_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");

    const route = resolveRoute();
    expect(route.providerPresetId).toBe("anthropic");
    expect(route.vendorModelId).toBe("deepseek-v4-pro");
  });

  it("prefers deepseek over anthropic when both keys exist and model prefers deepseek", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-ds");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant");
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");

    const route = resolveRoute();
    expect(route.providerPresetId).toBe("deepseek");
    expect(route.vendorModelId).toBe("deepseek-v4-flash");
  });

  it("throws when no provider API key is configured", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => resolveRoute()).toThrow(/DEEPSEEK_API_KEY or ANTHROPIC_API_KEY/);
  });

  it("throws when explicit preset lacks API key", () => {
    vi.stubEnv("MOONTIDE_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => resolveRoute()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("uses openai-chat-completions for json_object judge route on deepseek", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");

    const agent = resolveRoute("deepseek-v4-flash");
    expect(agent.adapterFamily).toBe("anthropic-messages");

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
});
