import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoopContext } from "../src/agent/deps.js";
import { setWorkdir } from "../src/config.js";
import { agentLoop } from "../src/agent/loop.js";
import * as llm from "../src/llm/client/anthropic.js";
import type { UserInteraction } from "../src/agent/tools/types.js";

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

function loopContext(userInteraction: UserInteraction): LoopContext {
  return {
    userInteraction,
    isCompactAutoEnabled: () => false,
  };
}

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocula-loop-"));
  setWorkdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("agentLoop", () => {
  it("returns assistant text when stop_reason is end_turn", async () => {
    vi.spyOn(llm, "chat").mockResolvedValue(
      assistantMessage([{ type: "text", text: "Hello from model" }]),
    );

    const messages = [{ role: "user" as const, content: "hi" }];
    const { reply, turn } = await agentLoop(messages, loopContext(denyAllInteraction));

    expect(reply).toBe("Hello from model");
    expect(turn).toBe(1);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("runs tool_use and continues until end_turn", async () => {
    fs.writeFileSync(path.join(tmpDir, "demo.txt"), "file content", "utf8");

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

    const messages = [{ role: "user" as const, content: "read demo.txt" }];
    const { reply, turn } = await agentLoop(messages, loopContext(denyAllInteraction));

    expect(reply).toBe("Read complete");
    expect(turn).toBe(2);
    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(4);
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

    const messages = [{ role: "user" as const, content: "run bad command" }];
    await agentLoop(messages, loopContext(denyAllInteraction));

    const toolResult = messages[2];
    expect(toolResult?.role).toBe("user");
    if (toolResult && Array.isArray(toolResult.content)) {
      const block = toolResult.content[0];
      if (block && typeof block === "object" && "content" in block) {
        expect(String(block.content)).toContain("Permission denied");
      }
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

    const messages = [{ role: "user" as const, content: "delete foo" }];
    await agentLoop(messages, loopContext(interaction));

    const toolResult = messages[2];
    if (toolResult && Array.isArray(toolResult.content)) {
      const block = toolResult.content[0];
      if (block && typeof block === "object" && "content" in block) {
        expect(String(block.content)).toContain("Permission denied by user");
      }
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

    const messages = [{ role: "user" as const, content: "echo" }];
    await agentLoop(messages, loopContext(interaction));

    const toolResult = messages[2];
    if (toolResult && Array.isArray(toolResult.content)) {
      const block = toolResult.content[0];
      if (block && typeof block === "object" && "content" in block) {
        expect(String(block.content)).toContain("approved");
      }
    }
  });
});
