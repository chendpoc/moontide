import type { Message } from "@moontide/llm/protocol";
import type { ModelProfile } from "@moontide/llm/models";
import {
  DEFAULT_L1_CAP,
  DEFAULT_L3_CAP,
  THINKING_HEADROOM_DEFAULT,
  estimateDialogueTokens,
  estimatePinnedTokens,
  findTierUsage,
  isDialogueOverThreshold,
  resolveBudgetPolicy,
  resolveL4Reserved,
  sumInputTierTokens,
} from "@moontide/context-composer/budget";
import { defaultBudgetConfig } from "@moontide/context-composer/ports";
import { afterEach, describe, expect, it, vi } from "vitest";
import { budgetConfigFromEnv } from "./helpers/budget-config.js";

function profile128k(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    logicalModelId: "deepseek-v4-pro",
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsThinking: false,
    tokenCount: "estimate",
    ...overrides,
  };
}

describe("context budget policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves L4 from ModelProfile without thinking headroom", () => {
    expect(resolveL4Reserved(profile128k())).toBe(8192);
  });

  it("resolves L4 with thinking headroom when supported", () => {
    expect(resolveL4Reserved(profile128k({ supportsThinking: true }))).toBe(
      8192 + THINKING_HEADROOM_DEFAULT,
    );
  });

  it("computes L2_limit for 128k MVP defaults without flex", () => {
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_FLEX", "0");
    const policy = resolveBudgetPolicy({
      modelProfile: profile128k(),
      budget: budgetConfigFromEnv(),
    });
    // C=128k, L4=8192, L1_cap=32k, L3_cap=10k → L2=128000-8192-32000-10000=77808
    expect(policy.dialogueLimitTokens).toBe(77_808);
    expect(findTierUsage(policy, "reserved").limitTokens).toBe(8192);
    expect(findTierUsage(policy, "pinned").limitTokens).toBe(DEFAULT_L1_CAP);
    expect(findTierUsage(policy, "reference").limitTokens).toBe(DEFAULT_L3_CAP);
  });

  it("honors MOONTIDE_CONTEXT_BUDGET_* overrides", () => {
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_FLEX", "0");
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_L1", "40000");
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_L3", "8000");
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_L4", "10000");

    const policy = resolveBudgetPolicy({
      modelProfile: profile128k(),
      budget: budgetConfigFromEnv(),
    });
    expect(findTierUsage(policy, "reserved").limitTokens).toBe(10_000);
    expect(findTierUsage(policy, "pinned").limitTokens).toBe(40_000);
    expect(findTierUsage(policy, "reference").limitTokens).toBe(8_000);
    expect(policy.dialogueLimitTokens).toBe(128_000 - 10_000 - 40_000 - 8_000);
  });

  it("estimates pinned and dialogue tokens without double-counting", () => {
    const system = "You are helpful.";
    const tools = [
      {
        name: "Read",
        description: "Read file",
        input_schema: { type: "object", properties: {} },
      },
    ];
    const messages: Message[] = [{ role: "user", content: "hello there" }];
    const modelId = "deepseek-v4-pro";

    const pinned = estimatePinnedTokens(system, tools, modelId);
    const dialogue = estimateDialogueTokens(messages, modelId);
    const policy = resolveBudgetPolicy({
      modelProfile: profile128k(),
      system,
      tools,
      messages,
    });

    expect(findTierUsage(policy, "pinned").estimatedTokens).toBe(pinned);
    expect(findTierUsage(policy, "dialogue").estimatedTokens).toBe(dialogue);
    expect(sumInputTierTokens(policy)).toBe(pinned + dialogue);
  });

  it("isDialogueOverThreshold uses L2 allocation only", () => {
    const policy = resolveBudgetPolicy({ modelProfile: profile128k() });
    const limit = policy.dialogueLimitTokens;
    expect(isDialogueOverThreshold(policy, limit * 0.79, 80)).toBe(false);
    expect(isDialogueOverThreshold(policy, limit * 0.8, 80)).toBe(true);
  });

  it("includes L5 flex tier by default", () => {
    const policy = resolveBudgetPolicy({
      modelProfile: profile128k(),
      budget: defaultBudgetConfig,
    });
    expect(findTierUsage(policy, "flex").limitTokens).toBe(6_400);
    expect(policy.dialogueLimitTokens).toBe(77_808 - 6_400);
  });
});
