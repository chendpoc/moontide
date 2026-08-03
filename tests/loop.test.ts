import fs from "node:fs";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../src/agent/agent-session.js";
import { createDefaultLoopContext } from "../src/agent/deps.js";
import type { LoopContext } from "../src/agent/deps.js";
import { createDefaultRunHooks } from "../src/agent/run-hooks.js";
import { setWorkdir } from "../src/config.js";
import * as llm from "../src/llm/client/anthropic.js";
import type { UserInteraction } from "../src/tools/types.js";
import { sessionLogPath } from "../src/session/paths.js";
import { joinPath } from "../src/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

function assistantMessage(
  content: Message["content"],
  stopReason: Message["stop_reason"] = "end_turn",
): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content,
  };
}

function runContext(
  agentSession: AgentSession,
  userInteraction: UserInteraction,
): LoopContext {
  return {
    userInteraction,
    session: agentSession.session,
  };
}

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-agent-run-");
  setWorkdir(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
  vi.restoreAllMocks();
});

describe("AgentSession.run", () => {
  it("returns assistant text when stop_reason is end_turn", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue(
      assistantMessage([{ type: "text", text: "Hello from model" }]),
    );

    const agentSession = AgentSession.create(tmpDir);
    const { reply, turn } = await agentSession.run(
      "hi",
      runContext(agentSession, denyAllInteraction),
      createDefaultRunHooks(),
    );

    expect(reply).toBe("Hello from model");
    expect(turn).toBe(1);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("runs tool_use and continues until end_turn", async () => {
    fs.writeFileSync(joinPath(tmpDir, "demo.txt"), "file content", "utf8");

    vi.spyOn(llm, "chat")
      .mockResolvedValueOnce(
        assistantMessage(
          [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "read_file",
              input: { path: "demo.txt" },
            },
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(
        assistantMessage([{ type: "text", text: "Read complete" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    const { reply, turn } = await agentSession.run(
      "read demo.txt",
      runContext(agentSession, denyAllInteraction),
      createDefaultRunHooks(),
    );

    expect(reply).toBe("Read complete");
    expect(turn).toBe(2);
    expect(llm.chat).toHaveBeenCalledTimes(2);
    const log = await agentSession.session.readLog();
    expect(log.some((r) => r.kind === "tool_outcome")).toBe(true);
  });

  it("blocks deny-class tools via Tool Use Module", async () => {
    vi.spyOn(llm, "chat")
      .mockResolvedValueOnce(
        assistantMessage(
          [
            {
              type: "tool_use",
              id: "toolu_deny",
              name: "bash",
              input: { command: "rm -rf /" },
            },
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(
        assistantMessage([{ type: "text", text: "Acknowledged deny" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "run bad command",
      runContext(agentSession, denyAllInteraction),
      createDefaultRunHooks(),
    );

    const log = await agentSession.session.readLog();
    const outcome = log.find((r) => r.kind === "tool_outcome");
    expect(outcome?.kind).toBe("tool_outcome");
    if (outcome?.kind === "tool_outcome") {
      expect(outcome.resultSummary.summary).toContain("Permission denied");
    }
  });

  it("denies ask-class tools when user does not approve", async () => {
    const interaction: UserInteraction = {
      ...denyAllInteraction,
      approveTool: async () => false,
    };

    vi.spyOn(llm, "chat")
      .mockResolvedValueOnce(
        assistantMessage(
          [
            {
              type: "tool_use",
              id: "toolu_ask",
              name: "bash",
              input: { command: "rm foo.txt" },
            },
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(
        assistantMessage([{ type: "text", text: "User declined" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "delete foo",
      runContext(agentSession, interaction),
      createDefaultRunHooks(),
    );

    const log = await agentSession.session.readLog();
    const outcome = log.find((r) => r.kind === "tool_outcome");
    if (outcome?.kind === "tool_outcome") {
      expect(outcome.resultSummary.summary).toContain("Permission denied by user");
    }
  });

  it("runs ask-class tools when user approves", async () => {
    const interaction: UserInteraction = {
      ...denyAllInteraction,
      approveTool: async () => true,
    };

    vi.spyOn(llm, "chat")
      .mockResolvedValueOnce(
        assistantMessage(
          [
            {
              type: "tool_use",
              id: "toolu_ok",
              name: "bash",
              input: { command: "echo approved" },
            },
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(
        assistantMessage([{ type: "text", text: "Done" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "echo",
      runContext(agentSession, interaction),
      createDefaultRunHooks(),
    );

    const log = await agentSession.session.readLog();
    const outcome = log.find((r) => r.kind === "tool_outcome");
    if (outcome?.kind === "tool_outcome") {
      expect(outcome.resultSummary.summary).toContain("approved");
    }
  });

  it("writes session log during run", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue(
      assistantMessage([{ type: "text", text: "Logged reply" }]),
    );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "log me",
      createDefaultLoopContext(agentSession.session),
      createDefaultRunHooks(),
    );

    expect(fs.existsSync(sessionLogPath(tmpDir, agentSession.session.sessionId))).toBe(true);
    const log = await agentSession.session.readLog();
    expect(log.some((r) => r.kind === "user_message")).toBe(true);
    expect(log.some((r) => r.kind === "assistant_message")).toBe(true);
  });
});
