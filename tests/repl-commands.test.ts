import { describe, expect, it } from "vitest";

import { handleReplCommand } from "../src/cli/commands/repl.js";
import { startReplSession, resetReplSession } from "../src/cli/repl/session.js";

const fakeRl = {} as import("node:readline/promises").Interface;

describe("repl commands", () => {
  it("returns unknown for removed observability commands", async () => {
    const result = await handleReplCommand("/trace", {
      rl: fakeRl,
      getMessages: () => null,
      resetConversation: () => {},
    });
    expect(result).toBe("unknown");
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
