import { afterEach, describe, expect, it, vi } from "vitest";

import { contextLimit } from "../apps/moontide/src/config.js";
import { resolveModelProfile } from "@moontide/llm/models";

describe("llm model registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves known model context window from registry", () => {
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");
    expect(resolveModelProfile().contextWindow).toBe(128_000);
    expect(resolveModelProfile().logicalModelId).toBe("deepseek-v4-pro");
    expect(resolveModelProfile().supportsTools).toBe(true);
  });

  it("resolves flash model from registry", () => {
    vi.stubEnv("MODEL_ID", "deepseek-v4-flash");
    expect(resolveModelProfile().contextWindow).toBe(128_000);
  });

  it("falls back for unknown model id", () => {
    vi.stubEnv("MODEL_ID", "unknown-model");
    const profile = resolveModelProfile();
    expect(profile.contextWindow).toBe(128_000);
    expect(profile.supportsTools).toBe(true);
  });

  it("MOONTIDE_CONTEXT_LIMIT overrides registry", () => {
    vi.stubEnv("MODEL_ID", "deepseek-v4-pro");
    vi.stubEnv("MOONTIDE_CONTEXT_LIMIT", "64000");
    expect(resolveModelProfile().contextWindow).toBe(64_000);
    expect(contextLimit()).toBe(64_000);
  });
});
