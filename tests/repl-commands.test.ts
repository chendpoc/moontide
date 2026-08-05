import { describe, expect, it, afterEach } from "vitest";
import type { Interface } from "node:readline/promises";

import { handleReplCommand } from "../src/cli/commands/repl.js";
import { resetReplConversation } from "../src/cli/commands/reset.js";
import { getReplAgentSession, resetReplSession, startReplSession } from "../src/cli/repl/session.js";
import {
  isThinkingEnabled,
  resetObservabilityOverrides,
} from "../src/log/modes.js";
import {
  isAlwaysAllowEnabled,
  resetAlwaysAllowOverride,
  setAlwaysAllowOverride,
} from "../src/tools/always-allow-mode.js";
import {
  getDebugLevel,
  resetDebugOverride,
  setDebugOverride,
} from "../src/context-inspect/debug-mode.js";

const fakeRl = {} as Interface;

const emptyCtx = {
  rl: fakeRl,
  getAgentSession: () => null,
  resetConversation: resetReplConversation,
};

describe("repl commands", () => {
  afterEach(() => {
    resetObservabilityOverrides();
    resetDebugOverride();
    resetAlwaysAllowOverride();
    resetReplSession();
  });

  it("returns unknown for legacy /trace command", async () => {
    const result = await handleReplCommand("/trace", emptyCtx);
    expect(result).toBe("unknown");
  });

  it("toggles thinking mode", async () => {
    const result = await handleReplCommand("/thinking on", emptyCtx);
    expect(result).toBe("handled");
    expect(isThinkingEnabled()).toBe(true);
  });

  it("reports verbose status", async () => {
    const result = await handleReplCommand("/verbose status", emptyCtx);
    expect(result).toBe("handled");
  });

  it("toggles debug mode", async () => {
    const result = await handleReplCommand("/debug file", emptyCtx);
    expect(result).toBe("handled");
    expect(getDebugLevel()).toBe("file");
  });

  it("resets debug override on /reset", async () => {
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
    const { replCommandHelpSections } = await import("../src/cli/commands/registry.js");
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
    expect(syntaxes).toContain("/debug on|terminal|file|off|status");
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
