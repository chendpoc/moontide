import { describe, expect, it } from "vitest";

import { composeContext } from "../src/context/composer/compose.js";
import { applyPrune, applySummary, applyTailWindow } from "../src/context/composer/compaction/apply.js";
import { defaultCompactionPolicy } from "../src/context/composer/compaction/policy.js";
import { resolveToolDefinitions } from "../src/context/composer/tool-definitions/index.js";
import {
  createStubArtifactStore,
  createStubCheckpointStore,
  createStubCompactionStore,
} from "../src/session/stores/index.js";
import type { CompactionSave } from "../src/session/stores/compaction-types.js";
import type { SessionMessage } from "../src/session/types.js";
import { getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

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
  const baseInput = {
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
  };

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
  });
});

describe("compaction apply helpers", () => {
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
});
