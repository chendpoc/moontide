import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSession } from "../../src/agent/agent-session.js";
import { sessionIndexPath, sessionLogPath } from "../../src/session/paths.js";
import {
  autoSaveSession,
  formatSessionLine,
  formatStartupHint,
  getLatestSessionEntry,
  listSessions,
  loadSessionIndex,
  printStartupHint,
  upsertSessionEntry,
} from "../../src/plugins/builtin/session-persistence/index.js";
import type { SessionPersistenceDeps } from "../../src/plugins/builtin/session-persistence/index.js";
import { setWorkdir } from "../../src/config.js";
import { setStderrWriterForTest } from "../../src/terminal/write.js";
import { clearTestRuntime, installTestRuntime } from "../helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "../helpers/tmp-workdir.js";

let tmpDir = "";
let testRuntime: ReturnType<typeof installTestRuntime>;
let stderr = "";

function deps(getAgent: () => AgentSession | null): SessionPersistenceDeps {
  return {
    workdir: tmpDir,
    getAgentSession: getAgent,
    setAgentSession: () => {},
    reply: (message) => {
      stderr += `${message}\n`;
    },
  };
}

describe("session-persistence plugin", () => {
  beforeEach(() => {
    tmpDir = createTmpWorkdir("ocula-session-persist-");
    setWorkdir(tmpDir);
    testRuntime = installTestRuntime(tmpDir);
    stderr = "";
    setStderrWriterForTest((chunk) => {
      stderr += chunk;
      return true;
    });
  });

  afterEach(() => {
    setStderrWriterForTest(null);
    clearTestRuntime();
    removeTmpWorkdir(tmpDir);
  });

  it("upsertSessionEntry preserves existing label on auto-save", async () => {
    const agent = AgentSession.create(tmpDir, testRuntime);
    await agent.session.appendUser(1, "hello");

    fs.mkdirSync(`${tmpDir}/.ocula/sessions`, { recursive: true });
    fs.writeFileSync(
      sessionIndexPath(tmpDir),
      `${JSON.stringify({
        entries: [
          {
            sessionId: agent.session.sessionId,
            label: "debug-mode",
            savedAt: "2026-01-01T00:00:00.000Z",
            messageCount: 1,
            lastTurn: 1,
          },
        ],
      })}\n`,
      "utf8",
    );

    autoSaveSession(deps(() => agent));

    const index = loadSessionIndex(tmpDir);
    expect(index.entries[0]?.label).toBe("debug-mode");
    expect(index.entries[0]?.messageCount).toBe(1);
  });

  it("formatSessionLine shows label when present", () => {
    const line = formatSessionLine({
      sessionId: "20260804-195300-a1b2c3d4",
      label: "debug-mode",
      messageCount: 12,
      indexed: true,
    });
    expect(line).toBe("20260804-195300-a1b2c3d4 (debug-mode) · 12 messages");
  });

  it("formatStartupHint includes resume command", () => {
    const hint = formatStartupHint({
      sessionId: "20260804-195300-a1b2c3d4",
      label: "debug-mode",
      messageCount: 3,
      indexed: true,
    });
    expect(hint).toContain("20260804-195300-a1b2c3d4 (debug-mode)");
    expect(hint).toContain("/resume session 20260804-195300-a1b2c3d4");
  });

  it("getLatestSessionEntry prefers indexed savedAt over older disk file", async () => {
    const agent = AgentSession.create(tmpDir, testRuntime);
    await agent.session.appendUser(1, "indexed");

    upsertSessionEntry(tmpDir, agent.session.sessionId, {
      messageCount: 1,
      lastTurn: 1,
    });

    const otherId = "20260101-120000-abcdef01";
    fs.mkdirSync(`${tmpDir}/.ocula/sessions`, { recursive: true });
    fs.writeFileSync(sessionLogPath(tmpDir, otherId), '{"kind":"user_message"}\n', "utf8");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(sessionLogPath(tmpDir, otherId), oldTime, oldTime);

    const latest = getLatestSessionEntry(tmpDir);
    expect(latest?.sessionId).toBe(agent.session.sessionId);
  });

  it("listSessions merges indexed and disk-only sessions", async () => {
    const agent = AgentSession.create(tmpDir, testRuntime);
    await agent.session.appendUser(1, "hello");
    upsertSessionEntry(tmpDir, agent.session.sessionId, { messageCount: 1, lastTurn: 1 });

    const diskOnly = "20260101-120000-abcdef01";
    fs.writeFileSync(sessionLogPath(tmpDir, diskOnly), '{"kind":"user_message"}\n', "utf8");

    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(2);
    expect(sessions.some((entry) => entry.sessionId === agent.session.sessionId && entry.indexed)).toBe(
      true,
    );
    expect(sessions.some((entry) => entry.sessionId === diskOnly && !entry.indexed)).toBe(true);
  });

  it("printStartupHint is silent when no history", () => {
    stderr = "";
    printStartupHint(tmpDir);
    expect(stderr).toBe("");
  });

  it("printStartupHint prints last session line", async () => {
    const agent = AgentSession.create(tmpDir, testRuntime);
    await agent.session.appendUser(1, "hello");
    upsertSessionEntry(tmpDir, agent.session.sessionId, { messageCount: 1, lastTurn: 1 });

    stderr = "";
    printStartupHint(tmpDir);
    expect(stderr).toContain("Last session:");
    expect(stderr).toContain(agent.session.sessionId);
    expect(stderr).toContain("/resume session");
  });
});
