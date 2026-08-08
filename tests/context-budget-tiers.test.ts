import { describe, expect, it, vi } from "vitest";

import {
  composeContext,
  defaultCompactionPolicy,
  findTierUsage,
  resolveBudgetPolicy,
  sumInputTierTokens,
  resolveToolDefinitions,
} from "@moontide/context-composer";
import {
  createStubArtifactStore,
  createStubCheckpointStore,
  createStubCompactionStore,
} from "@moontide/session";
import type { SessionMessage } from "@moontide/session";
import { getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { withComposePorts } from "./helpers/compose-ports.js";
import { budgetConfigFromEnv } from "./helpers/budget-config.js";

function userMessage(id: string, turn: number, text: string, sessionId = "sess-budget"): SessionMessage {
  return {
    id,
    sessionId,
    turn,
    at: "2026-07-31T08:00:00.000Z",
    role: "user",
    content: text,
  };
}

describe("context budget tiers integration", () => {
  installTestRuntime();

  const modelProfile = {
    logicalModelId: "deepseek-v4-pro",
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsThinking: false,
    tokenCount: "estimate" as const,
  };

  it("128k MVP: L2_limit matches formula without flex", () => {
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_FLEX", "0");
    const policy = resolveBudgetPolicy({
      modelProfile,
      budget: budgetConfigFromEnv(),
    });
    expect(findTierUsage(policy, "reserved").limitTokens).toBe(8192);
    expect(policy.dialogueLimitTokens).toBe(128_000 - 8192 - 32_000 - 10_000);
  });

  it("manifest tier sum matches estimatedInputTokens", async () => {
    const composed = await composeContext(
      withComposePorts({
        sessionId: "sess-budget",
        turn: 1,
        messages: [userMessage("e1", 1, "hello world")],
        instructionState: { basePrompt: "rules", epoch: 1 },
        artifactStore: createStubArtifactStore(),
        compactionStore: createStubCompactionStore(),
        checkpointStore: createStubCheckpointStore(),
        toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
        modelProfile,
        compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
      }),
    );

    const tiers = composed.manifest.budgetTiers ?? [];
    const tierSum = tiers
      .filter((tier) => tier.tier === "pinned" || tier.tier === "dialogue" || tier.tier === "reference")
      .reduce((sum, tier) => sum + tier.estimatedTokens, 0);
    expect(composed.manifest.estimatedInputTokens).toBe(tierSum);
    expect(tierSum).toBe(
      sumInputTierTokens(
        resolveBudgetPolicy({
          modelProfile,
          system: composed.request.system,
          tools: composed.request.tools,
          messages: composed.request.messages,
          budget: budgetConfigFromEnv(),
        }),
      ),
    );
  });
});
