import { describe, expect, it, afterEach } from "vitest";
import type { Interface } from "node:readline/promises";

import { handleReplCommand } from "../src/cli/commands/repl.js";
import { startReplSession, resetReplSession } from "../src/cli/repl/session.js";
import {
  isThinkingEnabled,
  resetObservabilityOverrides,
} from "../src/events/modes.js";

const fakeRl = {} as Interface;

const emptyCtx = {
  rl: fakeRl,
  getAgentSession: () => null,
  resetConversation: () => {},
};

describe("repl commands", () => {
  afterEach(() => {
    resetObservabilityOverrides();
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

  it("does not treat non-commands as handled", async () => {
    const result = await handleReplCommand("hello", emptyCtx);
    expect(result).toBe("not_command");
  });

  it("returns unknown for bogus commands", async () => {
    const result = await handleReplCommand("/bogus", emptyCtx);
    expect(result).toBe("unknown");
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
});
