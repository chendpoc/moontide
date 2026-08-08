import { afterEach, describe, expect, it, vi } from "vitest";

import {
  explicitThinkingLevelFromEnv,
  isDeepThinkingBump,
  resolveThinkingLevel,
} from "@moontide/llm";

describe("resolveThinkingLevel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bumps deep mode to at least high when model supports thinking", () => {
    expect(
      resolveThinkingLevel({
        entry: { supportsThinking: true, defaultThinking: "medium" },
        deepMode: true,
      }),
    ).toBe("high");
    expect(isDeepThinkingBump({
      entry: { supportsThinking: true, defaultThinking: "medium" },
      deepMode: true,
    })).toBe(true);
  });

  it("keeps registry default when deep mode but model lacks thinking support", () => {
    expect(
      resolveThinkingLevel({
        entry: { supportsThinking: false, defaultThinking: "medium" },
        deepMode: true,
      }),
    ).toBe("medium");
    expect(isDeepThinkingBump({
      entry: { supportsThinking: false, defaultThinking: "medium" },
      deepMode: true,
    })).toBe(false);
  });

  it("respects MOONTIDE_THINKING_LEVEL over deep bump", () => {
    vi.stubEnv("MOONTIDE_THINKING_LEVEL", "low");
    expect(
      resolveThinkingLevel({
        entry: { supportsThinking: true, defaultThinking: "medium" },
        deepMode: true,
      }),
    ).toBe("low");
    expect(explicitThinkingLevelFromEnv()).toBe("low");
    expect(isDeepThinkingBump({
      entry: { supportsThinking: true, defaultThinking: "medium" },
      deepMode: true,
    })).toBe(false);
  });
});
