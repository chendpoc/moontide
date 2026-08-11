import { describe, expect, it } from "vitest";
import type { Interface } from "node:readline/promises";

import { handleReplCommand } from "../packages/agent-cli/src/cli/commands/repl.js";
import { resetReplConversation } from "../packages/agent-cli/src/cli/commands/reset.js";
import { resolveReplLine } from "../packages/agent-cli/src/cli/repl/dispatch.js";

const fakeRl = {} as Interface;

const emptyCtx = {
  rl: fakeRl,
  getAgentSession: () => null,
  resetConversation: resetReplConversation,
};

describe("resolveReplLine", () => {
  it("continues on empty input", async () => {
    expect(await resolveReplLine("", emptyCtx)).toEqual({ kind: "continue" });
  });

  it("exits on /exit", async () => {
    expect(await resolveReplLine("/exit", emptyCtx)).toEqual({ kind: "exit" });
  });

  it("exits on /quit alias", async () => {
    expect(await resolveReplLine("/quit", emptyCtx)).toEqual({ kind: "exit" });
  });

  it("does not exit on bare exit or q", async () => {
    expect(await resolveReplLine("exit", emptyCtx)).toEqual({ kind: "agent", prompt: "exit" });
    expect(await resolveReplLine("q", emptyCtx)).toEqual({ kind: "agent", prompt: "q" });
  });

  it("routes non-command input to agent", async () => {
    expect(await resolveReplLine("hello", emptyCtx)).toEqual({ kind: "agent", prompt: "hello" });
  });
});

describe("/exit command", () => {
  it("returns exit result", async () => {
    expect(await handleReplCommand("/exit", emptyCtx)).toBe("exit");
    expect(await handleReplCommand("/quit", emptyCtx)).toBe("exit");
  });
});
