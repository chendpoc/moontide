import type { Message } from "@moontide/llm/protocol";
import type { ModelProfile } from "@moontide/llm/models";
import {
  ARTIFACT_FOOTNOTE_PREFIX,
  buildBudgetAlerts,
  COMPACT_PLACEHOLDER_PREFIX,
  enforceL3ReferenceBudget,
  estimateDialogueTokens,
  estimateReferenceTokens,
  findTierUsage,
  isReferenceToolResultBody,
  resolveBudgetPolicy,
} from "@moontide/context-composer/budget";
import { defaultBudgetConfig } from "@moontide/context-composer/ports";
import { spillOptions } from "../packages/agent/src/config.js";
import { createMemoryArtifactStore } from "@moontide/session";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function profile128k(): ModelProfile {
  return {
    logicalModelId: "deepseek-v4-pro",
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsThinking: false,
    tokenCount: "estimate",
  };
}

describe("L3 reference classification", () => {
  it("only counts spilled and compact bodies as L3 reference", () => {
    expect(isReferenceToolResultBody(`${COMPACT_PLACEHOLDER_PREFIX} 100 chars omitted]`)).toBe(true);
    expect(isReferenceToolResultBody(`preview\n${ARTIFACT_FOOTNOTE_PREFIX} art_1 · 9000 bytes stored]`)).toBe(true);
    expect(isReferenceToolResultBody("short inline ok")).toBe(false);
    expect(isReferenceToolResultBody("x".repeat(500))).toBe(false);
  });

  it("splits dialogue vs reference token estimates", () => {
    const messages: Message[] = [
      { role: "user", content: "hello world with enough tokens to count" },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "inline tool ok" }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t2",
            content: `p\n${ARTIFACT_FOOTNOTE_PREFIX} art · 100 bytes stored]`,
          },
        ],
      },
    ];
    const modelId = "deepseek-v4-pro";
    const reference = estimateReferenceTokens(messages, modelId);
    const dialogue = estimateDialogueTokens(messages, modelId);
    expect(reference).toBeGreaterThan(0);
    expect(dialogue).toBeGreaterThan(reference);
  });
});

describe("L3 enforce with spill", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpWorkdir("moontide-l3-enforce-");
  });

  afterEach(() => {
    removeTmpWorkdir(tmpDir);
    vi.unstubAllEnvs();
  });

  it("spills oversized inline tool results through ArtifactStore", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "64");
    const store = createMemoryArtifactStore();
    const big = "z".repeat(400);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: big }],
      },
    ];

    const enforced = await enforceL3ReferenceBudget({
      messages,
      l3Cap: 10_000,
      modelId: "deepseek-v4-pro",
      sessionId: "sess-enforce",
      artifactStore: store,
      workdir: tmpDir,
      spillOptions: spillOptions(),
    });

    expect(enforced.spilledCount).toBe(1);
    const body = (enforced.messages[0]?.content as Array<{ content: string }>)[0]?.content;
    expect(body).toContain("[artifact:");
    expect(enforced.afterTokens).toBeGreaterThan(0);
  });

  it("compacts reference summaries when still over L3 cap after spill", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");
    const store = createMemoryArtifactStore();
    const messages: Message[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "a",
            content: `preview a\n${ARTIFACT_FOOTNOTE_PREFIX} id-a · 1kb stored]`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "b",
            content: `preview b\n${ARTIFACT_FOOTNOTE_PREFIX} id-b · 2kb stored]`,
          },
        ],
      },
    ];
    const before = estimateReferenceTokens(messages, "deepseek-v4-pro");
    const enforced = await enforceL3ReferenceBudget({
      messages,
      l3Cap: Math.max(1, before - 1),
      modelId: "deepseek-v4-pro",
      sessionId: "sess-compact",
      artifactStore: store,
      workdir: tmpDir,
      spillOptions: spillOptions(),
    });

    expect(enforced.compactedCount).toBeGreaterThan(0);
    expect(enforced.afterTokens).toBeLessThanOrEqual(Math.max(1, before - 1));
  });
});

describe("L1 workingSet subAccounts", () => {
  it("adds workingSet subAccount under pinned tier", () => {
    const systemBase = "base rules";
    const ws = "## Decisions\nUse redis\n";
    const policy = resolveBudgetPolicy({
      modelProfile: profile128k(),
      system: `${systemBase}\n\n## Working set\n\n${ws}`,
      systemBase,
      workingSetSnapshot: ws,
      tools: [],
      messages: [],
      budget: { ...defaultBudgetConfig, flexEnabled: false },
    });
    const pinned = findTierUsage(policy, "pinned");
    expect(pinned.subAccounts?.workingSet.estimatedTokens).toBeGreaterThan(0);
    expect(pinned.subAccounts?.workingSet.limitTokens).toBeGreaterThan(0);
  });
});

describe("reference_over_budget alert", () => {
  it("emits alert when reference tier exceeds cap", () => {
    const policy = resolveBudgetPolicy({
      modelProfile: profile128k(),
      referenceTokens: 20_000,
      budget: { ...defaultBudgetConfig, flexEnabled: false },
    });
    const alerts = buildBudgetAlerts(policy);
    expect(alerts.some((alert) => alert.code === "reference_over_budget")).toBe(true);
  });
});
