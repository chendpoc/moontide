import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeForSession } from "../apps/moontide/src/agent/compose-for-turn.js";
import {
  applyDeepPromptGate,
  getActiveWorkMemId,
  resetDeepModeOnNewSession,
} from "../apps/moontide/src/agent/deep-mode.js";
import { composeContext } from "@moontide/context-composer";
import { defaultCompactionPolicy } from "@moontide/context-composer";
import { resolveToolDefinitions } from "@moontide/context-composer";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { runWorkMem } from "@moontide/tools";
import { readWorkMemEvents } from "@moontide/tools";
import { Session } from "@moontide/session";
import { withComposePorts } from "./helpers/compose-ports.js";
import {
  createStubArtifactStore,
  createStubCheckpointStore,
  createStubCompactionStore,
} from "@moontide/session";
import type { SessionMessage } from "@moontide/session";
import { clearTestRuntime, getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

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

describe("Deep Task Mode compose integration", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "moontide-deep-compose-"));
    setWorkdir(workdir);
    resetDeepModeOnNewSession();
    installTestRuntime(workdir);
  });

  afterEach(() => {
    resetDeepModeOnNewSession();
    clearTestRuntime();
    rmSync(workdir, { recursive: true, force: true });
  });

  it("injects protocol and seeded outline via composeForSession without manual work_mem", async () => {
    const session = Session.create(workdir);
    applyDeepPromptGate("deep: trace auth regression", session.sessionId);
    await session.appendUser(1, "continue investigation");

    const composed = await composeForSession({
      session,
      stores: {
        artifacts: createStubArtifactStore(),
        compaction: createStubCompactionStore(),
        checkpoints: createStubCheckpointStore(),
      },
      turn: 1,
      toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
    });

    expect(composed.request.system).toContain("## Deep Task Mode (active)");
    expect(composed.request.system).toContain("trace auth regression");
    expect(composed.request.system).toContain("## Working set (Deep Task Mode)");
    expect(composed.request.system).toContain("Open questions");
    expect(composed.manifest.deepTask).toMatchObject({
      active: true,
      goal: "trace auth regression",
    });
    expect(composed.manifest.deepTask?.workMemId).toMatch(/^wm_/);
  });

  it("injects Working Set snapshot into system via composeForSession", async () => {
    const session = Session.create(workdir);
    applyDeepPromptGate("deep: trace auth regression", session.sessionId);
    runWorkMem(
      { action: "draft", kind: "outline", content: "Reproduce 401 on token refresh" },
      { workdir, sessionId: session.sessionId },
    );

    await session.appendUser(1, "continue investigation");

    const composed = await composeForSession({
      session,
      stores: {
        artifacts: createStubArtifactStore(),
        compaction: createStubCompactionStore(),
        checkpoints: createStubCheckpointStore(),
      },
      turn: 2,
      toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
    });

    expect(composed.request.system).toContain("## Working set (Deep Task Mode)");
    expect(composed.request.system).toContain("Reproduce 401 on token refresh");
    const pinned = composed.manifest.budgetTiers?.find((tier) => tier.tier === "pinned");
    expect(pinned?.subAccounts?.workingSet).toBeDefined();
    expect(pinned?.subAccounts?.workingSet.estimatedTokens).toBeGreaterThan(0);
    expect(pinned?.subAccounts?.workingSet.limitTokens).toBeGreaterThan(0);
  });

  it("skips Working Set injection when deep mode is off", async () => {
    const session = Session.create(workdir);
    applyDeepPromptGate("deep: hidden task", session.sessionId);
    runWorkMem({ action: "draft", kind: "outline", content: "Hidden task state" }, {
      workdir,
      sessionId: session.sessionId,
    });
    resetDeepModeOnNewSession();
    await session.appendUser(1, "plain turn");

    const composed = await composeForSession({
      session,
      stores: {
        artifacts: createStubArtifactStore(),
        compaction: createStubCompactionStore(),
        checkpoints: createStubCheckpointStore(),
      },
      turn: 1,
      toolDefinitions: resolveToolDefinitions(getTestRuntime().tools),
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
    });

    expect(composed.request.system).not.toContain("## Working set (Deep Task Mode)");
    expect(composed.request.system).not.toContain("Hidden task state");
  });

  it("keeps Working Set in system after message prune and preserves jsonl", async () => {
    const sessionId = "sess-compose-prune";
    applyDeepPromptGate("deep: session store decision", sessionId);
    const workMemId = getActiveWorkMemId(sessionId)!;
    runWorkMem({ action: "draft", kind: "decision", content: "Keep redis session store" }, {
      workdir,
      sessionId,
    });
    const eventsBefore = readWorkMemEvents(workdir, sessionId, workMemId);

    const big = "x".repeat(5000);
    const messages = [
      userMessage("e1", 1, "read files", sessionId),
      {
        id: "e2",
        sessionId,
        turn: 1,
        at: "2026-07-31T08:00:01.000Z",
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, id: "t1", name: "Read", input: { path: "a.ts" } }],
      },
      {
        id: "e3",
        sessionId,
        turn: 1,
        at: "2026-07-31T08:00:02.000Z",
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "t1", content: big }],
      },
      userMessage("e4", 2, "second question", sessionId),
    ];

    const composed = await composeContext(
      withComposePorts({
        sessionId,
        turn: 2,
        messages,
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
          tokenCount: "estimate",
        },
        compactionPolicy: {
          ...defaultCompactionPolicy,
          autoEnabled: false,
          forcePrune: true,
          keepTurns: 1,
        },
        workingSetSnapshot: "## Decisions\nKeep redis session store\n",
      }),
    );

    expect(composed.request.system).toContain("## Working set (Deep Task Mode)");
    expect(composed.request.system).toContain("Keep redis session store");

    const pinned = composed.manifest.budgetTiers?.find((tier) => tier.tier === "pinned");
    expect(pinned?.subAccounts?.workingSet?.estimatedTokens).toBeGreaterThan(0);

    const toolResult = composed.request.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((block) => block.type === "tool_result");
    expect(toolResult && "content" in toolResult && typeof toolResult.content === "string").toBe(true);
    if (toolResult && "content" in toolResult && typeof toolResult.content === "string") {
      expect(toolResult.content.length).toBeLessThan(big.length);
    }

    const eventsAfter = readWorkMemEvents(workdir, sessionId, workMemId);
    expect(eventsAfter).toEqual(eventsBefore);
  });
});
