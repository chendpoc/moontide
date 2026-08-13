import { describe, expect, it, afterEach } from "vitest";
import type { Interface } from "node:readline/promises";

import { handleReplCommand } from "../packages/agent-cli/src/cli/commands/repl.js";
import { resetReplConversation } from "../packages/agent-cli/src/cli/commands/reset.js";
import { getReplAgentSession, resetReplSession, startReplSession } from "../packages/agent-cli/src/cli/repl/session.js";
import {
  isAlwaysAllowEnabled,
  resetAlwaysAllowOverride,
  setAlwaysAllowOverride,
} from "../packages/agent/src/tools/always-allow-mode.js";
import {
  getDebugLevel,
  resetDebugOverride,
  setDebugOverride,
} from "../packages/agent/src/context-inspect/debug-mode.js";
import { setStderrWriterForTest } from "../packages/agent-cli/src/terminal/write.js";
import { DEBUG_WATCH_JQ_FILE } from "../packages/agent-cli/src/cli/debug-watch.js";
import { resetRun } from "../packages/agent-cli/src/log/index.js";

const fakeRl = {} as Interface;

const emptyCtx = {
  rl: fakeRl,
  getAgentSession: () => null,
  resetConversation: resetReplConversation,
};

describe("repl commands", () => {
  afterEach(() => {
    resetDebugOverride();
    resetAlwaysAllowOverride();
    resetReplSession();
  });

  it("returns unknown for legacy /trace command", async () => {
    const result = await handleReplCommand("/trace", emptyCtx);
    expect(result).toBe("unknown");
  });

  it("returns unknown for removed /verbose and /thinking commands", async () => {
    expect(await handleReplCommand("/verbose on", emptyCtx)).toBe("unknown");
    expect(await handleReplCommand("/thinking on", emptyCtx)).toBe("unknown");
  });

  it("toggles debug mode", async () => {
    const result = await handleReplCommand("/debug file", emptyCtx);
    expect(result).toBe("handled");
    expect(getDebugLevel()).toBe("file");
  });

  it("debug status prints multi-line tail hint when session exists", async () => {
    setDebugOverride("file");
    const lines: string[] = [];
    setStderrWriterForTest((chunk) => {
      lines.push(chunk);
      return true;
    });
    const agentSession = startReplSession();
    resetRun("debug-status-run");
    try {
      const result = await handleReplCommand("/debug status", {
        rl: fakeRl,
        getAgentSession: () => agentSession,
        resetConversation: () => {},
      });
      expect(result).toBe("handled");
      const out = lines.join("");
      expect(out).toContain(`session ${agentSession.session.sessionId}`);
      expect(out).toContain("run debug-status-run");
      expect(out).toContain("watch (new terminal");
      expect(out).toContain("tail -f '");
      expect(out).toContain("jq -C -R -r -f");
      expect(out).toContain(DEBUG_WATCH_JQ_FILE);
      expect(out).not.toContain("fromjson?");
      expect(out).toContain(`${agentSession.session.sessionId}.jsonl`);
    } finally {
      setStderrWriterForTest(null);
    }
  });

  it("debug status prints placeholder tail command without session", async () => {
    const lines: string[] = [];
    setStderrWriterForTest((chunk) => {
      lines.push(chunk);
      return true;
    });
    try {
      const result = await handleReplCommand("/debug status", emptyCtx);
      expect(result).toBe("handled");
      const out = lines.join("");
      expect(out).toContain("tail -f '");
      expect(out).toContain("<session-id>");
      expect(out).not.toContain("pnpm dev");
    } finally {
      setStderrWriterForTest(null);
    }
  });

  it("resets debug override on /reset", async () => {
    delete process.env.MOONTIDE_ENV;
    delete process.env.MOONTIDE_DEBUG;
    setDebugOverride("file");
    const result = await handleReplCommand("/reset", emptyCtx);
    expect(result).toBe("handled");
    expect(getDebugLevel()).toBe("off");
  });

  it("toggles always-allow mode", async () => {
    const result = await handleReplCommand("/always-allow on", emptyCtx);
    expect(result).toBe("handled");
    expect(isAlwaysAllowEnabled()).toBe(true);
  });

  it("resets always-allow override on /reset", async () => {
    delete process.env.MOONTIDE_ENV;
    delete process.env.MOONTIDE_ALWAYS_ALLOW;
    setAlwaysAllowOverride(true);
    const result = await handleReplCommand("/reset", emptyCtx);
    expect(result).toBe("handled");
    expect(isAlwaysAllowEnabled()).toBe(false);
  });

  it("does not treat non-commands as handled", async () => {
    const result = await handleReplCommand("hello", emptyCtx);
    expect(result).toBe("not_command");
  });

  it("returns unknown for bogus commands", async () => {
    const result = await handleReplCommand("/bogus", emptyCtx);
    expect(result).toBe("unknown");
  });

  it("groups help output by category", async () => {
    const { replCommandHelpSections } = await import("../packages/agent-cli/src/cli/commands/registry.js");
    const sections = replCommandHelpSections();
    expect(sections.map((section) => section.category)).toEqual([
      "General",
      "Session",
      "Context",
      "Observability",
    ]);
    const syntaxes = sections.flatMap((section) => section.entries.map((entry) => entry.syntax));
    expect(syntaxes).toContain("/save");
    expect(syntaxes).toContain("/settings lang en|zh|status");
    expect(syntaxes).toContain("/debug on|file|off|status");
  });

  it("compact preview requires session", async () => {
    const result = await handleReplCommand("/compact preview", emptyCtx);
    expect(result).toBe("handled");
  });

  it("compact preview works with session log", async () => {
    const agentSession = startReplSession();
    await agentSession.session.appendUser(1, "hi");
    const result = await handleReplCommand("/compact preview", {
      rl: fakeRl,
      getAgentSession: () => agentSession,
      resetConversation: () => {},
    });
    expect(result).toBe("handled");
  });

  it("saves active session to index", async () => {
    const agentSession = startReplSession();
    await agentSession.session.appendUser(1, "hello");
    const result = await handleReplCommand("/save", {
      rl: fakeRl,
      getAgentSession: () => agentSession,
      resetConversation: resetReplConversation,
    });
    expect(result).toBe("handled");
  });

  it("loads session via /resume session", async () => {
    const agentSession = startReplSession();
    await agentSession.session.appendUser(1, "hello");
    const sessionId = agentSession.session.sessionId;
    resetReplSession();

    const result = await handleReplCommand(`/resume session ${sessionId}`, {
      rl: fakeRl,
      getAgentSession: getReplAgentSession,
      resetConversation: resetReplConversation,
    });
    expect(result).toBe("handled");
    expect(getReplAgentSession()?.session.sessionId).toBe(sessionId);
    expect(getReplAgentSession()?.session.getMessages()).toHaveLength(1);
  });
});
