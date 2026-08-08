import { describe, expect, it } from "vitest";

import {
  composeContext,
  shouldCompactDialogue,
  applyCompactionPolicy,
  applyPrune,
  applySummary,
  applyTailWindow,
  defaultCompactionPolicy,
  resolveToolDefinitions,
} from "@moontide/context-composer";
import {
  createStubArtifactStore,
  createStubCheckpointStore,
  createStubCompactionStore,
} from "@moontide/session";
import type { CompactionSave } from "@moontide/session";
import type { SessionMessage } from "@moontide/session";
import { getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { withComposePorts } from "./helpers/compose-ports.js";
import { defaultBudgetConfig } from "@moontide/context-composer/ports";

function userMessage(id: string, turn: number, text: string, sessionId = "sess-1"): SessionMessage {
  return {
    id,
    sessionId,
    turn,
    at: "2026-07-31T08:00:00.000Z",
    role: "user",
    content: text,
  };
}

describe("composeContext", () => {
  installTestRuntime();
  const baseInput = withComposePorts({
    sessionId: "sess-1",
    turn: 3,
    instructionState: { basePrompt: "system rules", epoch: 1 },
    artifactStore: createStubArtifactStore(),
    compactionStore: createStubCompactionStore(),
    checkpointStore: createStubCheckpointStore(),
    toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
    modelProfile: {
      logicalModelId: "claude-test",
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsThinking: false,
      tokenCount: "estimate" as const,
    },
    compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
  });

  it("composes messages and records compiledMessageItemIds", async () => {
    const messages = [
      userMessage("e1", 1, "hello"),
      userMessage("e2", 2, "follow up"),
    ];

    const composed = await composeContext({ ...baseInput, messages });

    expect(composed.request.system).toContain("system rules");
    expect(composed.manifest.sourceItemIds).toEqual(["e1", "e2"]);
    expect(composed.manifest.compiledMessageItemIds).toEqual(["e1", "e2"]);
    expect(composed.request.messages).toHaveLength(2);
    expect(composed.manifest.budgetTiers).toBeDefined();
    expect(composed.manifest.budgetTiers?.some((tier) => tier.tier === "dialogue")).toBe(true);
    expect(composed.manifest.estimatedInputTokens).toBeGreaterThan(0);
  });

  it("emits pinned_over_budget alert when system exceeds L1 cap", async () => {
    const composed = await composeContext({
      ...baseInput,
      messages: [userMessage("e1", 1, "hi")],
      instructionState: { basePrompt: "x".repeat(150_000), epoch: 1 },
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
    });

    expect(composed.manifest.alerts?.some((alert) => alert.code === "pinned_over_budget")).toBe(
      true,
    );
    expect(composed.manifest.budgetTiers?.find((tier) => tier.tier === "pinned")?.estimatedTokens).toBeGreaterThan(
      composed.manifest.budgetTiers?.find((tier) => tier.tier === "pinned")?.limitTokens ?? 0,
    );
  });
});

describe("compaction apply helpers", () => {
  installTestRuntime();

  it("applyTailWindow truncates to lastItemId", () => {
    const messages = [
      userMessage("e1", 1, "a"),
      userMessage("e2", 2, "b"),
      userMessage("e3", 3, "c"),
    ];
    expect(applyTailWindow(messages, "e2").map((m) => m.id)).toEqual(["e1", "e2"]);
  });

  it("applySummary replaces covered ids with summary message", () => {
    const messages = [
      userMessage("e1", 1, "old"),
      userMessage("e2", 2, "keep"),
    ];
    const save: CompactionSave = {
      id: "cmp-1",
      sessionId: "sess-1",
      createdAtTurn: 1,
      kind: "summary",
      coversItemIds: ["e1"],
      payload: { text: "rolled up" },
    };

    const next = applySummary(messages, save);
    expect(next).toHaveLength(2);
    expect(next[0]?.id).toBe("summary-cmp-1");
    expect(next[1]?.id).toBe("e2");
  });

  it("applyPrune shrinks old tool results", () => {
    const big = "x".repeat(5000);
    const messages = [
      { role: "user" as const, content: "read files" },
      {
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, id: "t1", name: "Read", input: { path: "a.ts" } }],
      },
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "t1", content: big }],
      },
      { role: "user" as const, content: "second question" },
    ];

    const result = applyPrune(messages, "sys", resolveToolDefinitions(getTestRuntime().tools), 1, "claude-test");
    expect(result.changed).toBe(true);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });

  it("applyCompactionPolicy auto-prunes on L2 usage, not L1-heavy system alone", () => {
    const modelProfile = {
      logicalModelId: "claude-test",
      contextWindow: 128_000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsThinking: false,
      tokenCount: "estimate" as const,
    };
    const tools = resolveToolDefinitions(getTestRuntime().tools);
    const policy = { ...defaultCompactionPolicy, autoEnabled: true, thresholdPercent: 50, keepTurns: 1 };
    const budget = { ...defaultBudgetConfig, flexEnabled: false };

    expect(
      shouldCompactDialogue({
        modelProfile,
        system: "x".repeat(60_000),
        tools,
        messages: [{ role: "user", content: "short" }],
        thresholdPercent: 50,
        budget,
      }),
    ).toBe(false);

    const dialogueMessages = [
      { role: "user" as const, content: "first task" },
      {
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, id: "t1", name: "Read", input: { path: "a.ts" } }],
      },
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "t1", content: "y".repeat(200_000) }],
      },
      { role: "user" as const, content: "second question" },
      { role: "assistant" as const, content: [{ type: "text", text: "done" }] },
      { role: "user" as const, content: "third question" },
    ];

    expect(
      shouldCompactDialogue({
        modelProfile,
        system: "system rules",
        tools,
        messages: dialogueMessages,
        thresholdPercent: 50,
        budget,
      }),
    ).toBe(true);

    const l1Heavy = applyCompactionPolicy(
      {
        sessionMessages: [],
        messages: [{ role: "user", content: "short" }],
        policy,
        system: "x".repeat(60_000),
        tools,
        modelId: modelProfile.logicalModelId,
        budget,
      },
      modelProfile,
    );
    expect(l1Heavy.truncatedToolResults).toBe(0);

    const l2Heavy = applyCompactionPolicy(
      {
        sessionMessages: [],
        messages: dialogueMessages,
        policy,
        system: "system rules",
        tools,
        modelId: modelProfile.logicalModelId,
        budget,
      },
      modelProfile,
    );
    expect(l2Heavy.truncatedToolResults).toBeGreaterThan(0);
  });
});
