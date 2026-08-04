import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerDefaultSidecarHooks, resetSidecarHooks } from "../src/agent/hooks/index.js";
import { AgentSession } from "../src/agent/agent-session.js";
import { composeContext } from "../src/context/composer/compose.js";
import {
  coversItemIdsForKeepFrom,
  runSummaryCompaction,
} from "../src/context/composer/compaction/run-summary-compaction.js";
import { defaultCompactionPolicy } from "../src/context/composer/compaction/policy.js";
import { compactionSavePath } from "../src/session/paths.js";
import { setWorkdir } from "../src/config.js";
import { resolveToolDefinitions } from "../src/context/composer/tool-definitions/index.js";
import { buildDefaultBasePrompt } from "../src/agent/prompt.js";
import type { SessionMessage } from "../src/session/types.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-compact-summary-");
  setWorkdir(tmpDir);
  registerDefaultSidecarHooks(tmpDir);
});

afterEach(() => {
  resetSidecarHooks();
  removeTmpWorkdir(tmpDir);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function userMessage(id: string, turn: number, text: string, sessionId: string): SessionMessage {
  return {
    id,
    sessionId,
    turn,
    at: "2026-07-31T08:00:00.000Z",
    role: "user",
    content: text,
  };
}

describe("coversItemIdsForKeepFrom", () => {
  it("returns session message ids before tail window", () => {
    const messages = [
      userMessage("e1", 1, "first", "s1"),
      userMessage("e2", 2, "second", "s1"),
      userMessage("e3", 3, "third", "s1"),
    ];
    const covered = coversItemIdsForKeepFrom(messages, 2);
    expect(covered).toEqual(["e1"]);
  });
});

describe("runSummaryCompaction", () => {
  it("writes CompactionSave and returns token stats", async () => {
    vi.stubEnv("OCULA_COMPACT_KEEP_TURNS", "1");
    vi.spyOn(await import("../src/llm/client/anthropic.js"), "getClient").mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "rolled up context" }],
        }),
      },
    } as never);

    const sessionMessages = [
      userMessage("e1", 1, "plan the refactor", "sess-1"),
      userMessage("e2", 2, "edit files", "sess-1"),
      userMessage("e3", 3, "latest question", "sess-1"),
    ];

    const result = await runSummaryCompaction({
      sessionId: "sess-1",
      turn: 3,
      sessionMessages,
      system: buildDefaultBasePrompt(),
      tools: resolveToolDefinitions(),
      keepTurns: 1,
    });

    expect(result.save.kind).toBe("summary");
    expect(result.save.payload).toEqual({ text: "rolled up context" });
    expect(result.save.coversItemIds.length).toBeGreaterThan(0);
    expect(result.beforeTokens).toBeGreaterThan(0);
  });
});

describe("AgentSession.runSummaryCompaction", () => {
  it("persists save, compaction item, and activates compose projection", async () => {
    vi.stubEnv("OCULA_COMPACT_KEEP_TURNS", "1");
    vi.spyOn(await import("../src/llm/client/anthropic.js"), "getClient").mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "summary body" }],
        }),
      },
    } as never);

    const agent = AgentSession.create(tmpDir);
    await agent.session.appendUser(1, "old task");
    await agent.session.appendUser(2, "middle");
    await agent.session.appendUser(3, "current");

    const result = await agent.runSummaryCompaction(3);
    expect(fs.existsSync(compactionSavePath(tmpDir, agent.session.sessionId, result.save.id))).toBe(
      true,
    );

    const items = await agent.session.readItems();
    expect(items.some((item) => item.kind === "compaction")).toBe(true);
    expect(agent.getActiveCompactionSaveId()).toBe(result.save.id);

    const composed = await composeContext({
      sessionId: agent.session.sessionId,
      turn: 4,
      messages: agent.session.getMessages(),
      instructionState: { basePrompt: "sys", epoch: 1 },
      artifactStore: agent.stores.artifacts,
      compactionStore: agent.stores.compaction,
      checkpointStore: agent.stores.checkpoints,
      toolDefinitions: resolveToolDefinitions(),
      modelProfile: {
        logicalModelId: "test",
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsThinking: false,
        tokenCount: "estimate",
      },
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
      activeCompactionSaveId: agent.getActiveCompactionSaveId(),
    });

    expect(composed.manifest.activeCompactionSaveId).toBe(result.save.id);
    expect(composed.request.messages[0]?.role).toBe("user");
    const firstContent = composed.request.messages[0]?.content;
    expect(typeof firstContent === "string" && firstContent.includes("summary body")).toBe(true);
  });
});

describe("AgentSession.runPruneCompaction", () => {
  it("sets force prune for next compose", async () => {
    vi.stubEnv("OCULA_COMPACT_KEEP_TURNS", "1");
    const agent = AgentSession.create(tmpDir);
    const big = "x".repeat(5000);
    await agent.session.appendUser(1, "read");
    await agent.session.appendAssistant(1, [
      { type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } },
    ]);
    await agent.session.appendToolOutcome(1, "t1", {
      summary: big,
      byteCount: big.length,
    });
    await agent.session.appendUser(2, "next");

    const preview = await agent.runPruneCompaction(2);
    expect(preview.wouldChange).toBe(true);
    expect(agent.getCompactionPolicy().forcePrune).toBe(true);
  });
});
