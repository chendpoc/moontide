import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveWorkingSetForCompose } from "../apps/moontide/src/agent/working-set-compose.js";
import { applyDeepPromptGate, getActiveWorkMemId, resetDeepModeOnNewSession } from "../apps/moontide/src/agent/deep-mode.js";
import { defaultCompactionPolicy } from "@moontide/context-composer";
import { resolveToolDefinitions } from "@moontide/context-composer";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { runWorkMem } from "@moontide/tools";
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

describe("resolveWorkingSetForCompose compaction and budget escalation", () => {
  let workdir: string;
  const sessionId = "sess-escalation-compose";

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "moontide-working-set-compose-"));
    setWorkdir(workdir);
    resetDeepModeOnNewSession();
    installTestRuntime(workdir);
    applyDeepPromptGate("deep: pressure test", sessionId);
  });

  afterEach(() => {
    resetDeepModeOnNewSession();
    clearTestRuntime();
    rmSync(workdir, { recursive: true, force: true });
  });

  it("escalates to refined_at_normal when compose would exceed compaction threshold", () => {
    runWorkMem({ action: "draft", kind: "outline", content: "Outline anchor" }, {
      workdir,
      sessionId,
    });
    const noteBody = "z".repeat(2000);
    for (let i = 0; i < 3; i += 1) {
      runWorkMem({ action: "note", content: `${noteBody}-note-${i}` }, { workdir, sessionId });
    }

    const workMemId = getActiveWorkMemId(sessionId)!;
    const tools = resolveToolDefinitions(getTestRuntime().tools);
    const modelProfile = {
      logicalModelId: "claude-test",
      contextWindow: 10_000,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsThinking: false,
      tokenCount: "estimate" as const,
    };
    const messages = [
      userMessage("e1", 1, "y".repeat(12_000), sessionId),
      userMessage("e2", 2, "follow up", sessionId),
    ];

    const resolved = resolveWorkingSetForCompose({
      sessionId,
      workMemId,
      modelProfile,
      instructionState: { basePrompt: "system rules", epoch: 1 },
      messages,
      tools,
      compactionPolicy: {
        ...defaultCompactionPolicy,
        autoEnabled: true,
        thresholdPercent: 50,
      },
    });

    expect(resolved?.stage).toBe("refined_at_normal");
    expect(resolved?.text).toContain("Outline anchor");
    expect(resolved?.text).toContain("note-2");
    expect(resolved?.text).not.toContain("note-0");
  });
});
