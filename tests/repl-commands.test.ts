import { describe, expect, it, afterEach } from "vitest";
import type { Interface } from "node:readline/promises";

import { handleReplCommand } from "../src/cli/commands/repl.js";
import { startReplSession, resetReplSession } from "../src/cli/repl/session.js";
import {
  isThinkingEnabled,
  resetObservabilityOverrides,
} from "../src/events/modes.js";

const fakeRl = {} as Interface;

describe("repl commands", () => {
  afterEach(() => {
    resetObservabilityOverrides();
  });

  it("returns unknown for legacy /trace command", async () => {
    const result = await handleReplCommand("/trace", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("unknown");
  });

  it("toggles thinking mode", async () => {
    const result = await handleReplCommand("/thinking on", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("handled");
    expect(isThinkingEnabled()).toBe(true);
  });

  it("reports verbose status", async () => {
    const result = await handleReplCommand("/verbose status", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("handled");
  });

  it("does not treat non-commands as handled", async () => {
    const result = await handleReplCommand("hello", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("not_command");
  });

  it("returns unknown for bogus commands", async () => {
    const result = await handleReplCommand("/bogus", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("unknown");
  });

  it("compact preview requires messages", async () => {
    resetReplSession();
    const result = await handleReplCommand("/compact preview", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("handled");
  });

  it("compact preview works with session messages", async () => {
    const messages = startReplSession();
    messages.push({ role: "user", content: "hi" });
    const result = await handleReplCommand("/compact preview", {
      rl: fakeRl,
      getMessages: () => messages,
      resetConversation: () => {},
    });
    expect(result).toBe("handled");
    resetReplSession();
  });
});
