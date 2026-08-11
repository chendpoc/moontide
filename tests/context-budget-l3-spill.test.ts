import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  composeContext,
  defaultCompactionPolicy,
  estimateReferenceTokens,
  resolveToolDefinitions,
} from "@moontide/context-composer";
import { composePortsFromConfig } from "../packages/agent/src/agent/compose-options.js";
import { setWorkdir } from "../packages/agent/src/config.js";
import { artifactPath } from "@moontide/session";
import {
  createStubCheckpointStore,
  createStubCompactionStore,
  FileArtifactStore,
} from "@moontide/session";
import type { SessionMessage } from "@moontide/session";
import { getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

function userMessage(id: string, turn: number, text: string, sessionId = "sess-l3"): SessionMessage {
  return {
    id,
    sessionId,
    turn,
    at: "2026-07-31T08:00:00.000Z",
    role: "user",
    content: text,
  };
}

describe("L3 spill integration at compose", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpWorkdir("moontide-l3-spill-");
    setWorkdir(tmpDir);
    installTestRuntime(tmpDir);
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_FLEX", "0");
  });

  afterEach(() => {
    removeTmpWorkdir(tmpDir);
    vi.unstubAllEnvs();
  });

  const modelProfile = {
    logicalModelId: "deepseek-v4-pro",
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsThinking: false,
    tokenCount: "estimate" as const,
  };

  it("spills oversized inline tool results via ArtifactStore before LLM request", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "64");
    const store = new FileArtifactStore(tmpDir);
    const big = "x".repeat(500);

    const composed = await composeContext({
      sessionId: "sess-l3",
      turn: 1,
      messages: [
        userMessage("e1", 1, "read file"),
        {
          id: "e2",
          sessionId: "sess-l3",
          turn: 1,
          at: "2026-07-31T08:00:01.000Z",
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } }],
        },
        {
          id: "e3",
          sessionId: "sess-l3",
          turn: 1,
          at: "2026-07-31T08:00:02.000Z",
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: big }],
        },
      ],
      instructionState: { basePrompt: "rules", epoch: 1 },
      artifactStore: store,
      compactionStore: createStubCompactionStore(),
      checkpointStore: createStubCheckpointStore(),
      toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
      modelProfile,
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
      ...composePortsFromConfig(tmpDir),
    });

    const toolResult = composed.request.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((block) => block.type === "tool_result");
    expect(toolResult && "content" in toolResult && typeof toolResult.content === "string").toBe(true);
    if (toolResult && "content" in toolResult && typeof toolResult.content === "string") {
      expect(toolResult.content).toContain("[artifact:");
      expect(toolResult.content).not.toBe(big);
    }

    const referenceTier = composed.manifest.budgetTiers?.find((tier) => tier.tier === "reference");
    expect(referenceTier?.estimatedTokens).toBeGreaterThan(0);

    const footnote = String(
      toolResult && "content" in toolResult ? toolResult.content : "",
    ).match(/\[artifact:([^\s·]+)/)?.[1];
    expect(footnote).toBeDefined();
    const artifact = await store.get("sess-l3", footnote!);
    expect(artifact?.byteCount).toBeGreaterThan(64);
    expect(fs.existsSync(artifactPath(tmpDir, "sess-l3", footnote!))).toBe(true);
  });

  it("enforces L3 cap by spilling then compacting reference summaries", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");
    vi.stubEnv("MOONTIDE_CONTEXT_BUDGET_L3", "200");
    const store = new FileArtifactStore(tmpDir);

    const messages: SessionMessage[] = [];
    for (let index = 0; index < 6; index += 1) {
      const toolId = `t${index}`;
      messages.push(userMessage(`u${index}`, 1, `task ${index}`));
      messages.push({
        id: `a${index}`,
        sessionId: "sess-l3-cap",
        turn: 1,
        at: "2026-07-31T08:00:00.000Z",
        role: "assistant",
        content: [{ type: "tool_use", id: toolId, name: "Read", input: { path: `${index}.ts` } }],
      });
      messages.push({
        id: `r${index}`,
        sessionId: "sess-l3-cap",
        turn: 1,
        at: "2026-07-31T08:00:01.000Z",
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: "line\n".repeat(80 + index * 20) }],
      });
    }

    const composed = await composeContext({
      sessionId: "sess-l3-cap",
      turn: 1,
      messages,
      instructionState: { basePrompt: "rules", epoch: 1 },
      artifactStore: store,
      compactionStore: createStubCompactionStore(),
      checkpointStore: createStubCheckpointStore(),
      toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
      modelProfile,
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
      ...composePortsFromConfig(tmpDir),
    });

    const referenceTier = composed.manifest.budgetTiers?.find((tier) => tier.tier === "reference");
    expect(referenceTier?.limitTokens).toBe(200);
    expect(referenceTier?.estimatedTokens).toBeLessThanOrEqual(200);

    const refEstimate = estimateReferenceTokens(composed.request.messages, modelProfile.logicalModelId);
    expect(refEstimate).toBeLessThanOrEqual(200);
    expect(composed.request.messages.some((message) => {
      if (!Array.isArray(message.content)) {
        return false;
      }
      return message.content.some((block) => {
        if (block.type !== "tool_result" || typeof block.content !== "string") {
          return false;
        }
        return block.content.includes("[artifact:") || block.content.startsWith("[compact:");
      });
    })).toBe(true);
  });
});
