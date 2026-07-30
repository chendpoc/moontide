import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continueReplAgent } from "../src/agent/loop.js";
import { getWorkdir, setWorkdir } from "../src/config.js";
import { resetEventPlatform, setupEventPipeline } from "../src/events/setup.js";
import * as llm from "../src/llm.js";
import type { UserInteraction } from "../src/toolkit/types.js";

let tmpDir = "";
let originalWorkdir = "";

const interaction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => [],
};

function assistantMessage(text: string): Message {
  return {
    id: `msg_${text}`,
    type: "message",
    role: "assistant",
    model: "test-model",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 2 },
    content: [{ type: "text", text }],
  };
}

beforeEach(() => {
  originalWorkdir = getWorkdir();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oculeau-run-storage-"));
  setWorkdir(tmpDir);
  setupEventPipeline();
});

afterEach(() => {
  resetEventPlatform();
  setWorkdir(originalWorkdir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("run storage integration", () => {
  it("seals each run and does not carry prior conversation context forward", async () => {
    vi.spyOn(llm, "chat")
      .mockResolvedValueOnce(assistantMessage("first reply"))
      .mockResolvedValueOnce(assistantMessage("second reply"));

    const messages: MessageParam[] = [];
    const loopContext = {
      userInteraction: interaction,
      isCompactAutoEnabled: () => false,
    };

    await continueReplAgent("first prompt sentinel", messages, loopContext);
    await continueReplAgent("second prompt", messages, loopContext);

    const storageDir = path.join(tmpDir, ".oculeau");
    const runsDir = path.join(storageDir, "runs");
    const files = fs.readdirSync(runsDir);
    expect(files.filter((file) => file.endsWith(".jsonl.gz"))).toHaveLength(2);
    expect(files.some((file) => file.endsWith(".active.jsonl"))).toBe(false);

    const archives = files
      .filter((file) => file.endsWith(".jsonl.gz"))
      .map((file) =>
        gunzipSync(fs.readFileSync(path.join(runsDir, file))).toString("utf8"),
      );
    const secondRun = archives.find((archive) =>
      archive.includes("second prompt"),
    );
    expect(secondRun).toBeDefined();
    expect(secondRun).not.toContain("first prompt sentinel");

    for (const archive of archives) {
      for (const line of archive.trim().split("\n")) {
        const parsed = JSON.parse(line) as {
          channel: string;
          payload: { report?: Record<string, unknown> };
        };
        if (parsed.channel === "context") {
          expect(parsed.payload.report).not.toHaveProperty("messageLines");
        }
      }
    }

    expect(fs.existsSync(path.join(storageDir, "context.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".oculeau-audit.log"))).toBe(false);
  });
});
