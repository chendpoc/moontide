import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../src/agent/agent-session.js";
import { continueReplAgent } from "../src/agent/loop.js";
import { getWorkdir, setWorkdir } from "../src/config.js";
import { resetEventPlatform, setupEventPipeline } from "../src/events/setup.js";
import * as llm from "../src/llm/client/anthropic.js";
import type { UserInteraction } from "../src/tools/types.js";
import { dataPath, joinPath } from "../src/utils/path.js";
import { RUNS_DIR } from "../src/constants/storage.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

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
  tmpDir = createTmpWorkdir("ocula-run-storage-");
  setWorkdir(tmpDir);
  setupEventPipeline();
});

afterEach(() => {
  resetEventPlatform();
  setWorkdir(originalWorkdir);
  removeTmpWorkdir(tmpDir);
  vi.restoreAllMocks();
});

describe("run storage integration", () => {
  it("seals each run and does not carry prior conversation context forward", async () => {
    vi.spyOn(llm, "chat")
      .mockResolvedValueOnce(assistantMessage("first reply"))
      .mockResolvedValueOnce(assistantMessage("second reply"));

    const agentSession = AgentSession.create(tmpDir);
    const loopContext = {
      userInteraction: interaction,
      session: agentSession.session,
    };

    await continueReplAgent("first prompt sentinel", agentSession, loopContext);
    await continueReplAgent("second prompt", agentSession, loopContext);

    const runsDir = dataPath(tmpDir, RUNS_DIR);
    const files = fs.readdirSync(runsDir);
    expect(files.filter((file) => file.endsWith(".jsonl.gz"))).toHaveLength(2);
    expect(files.some((file) => file.endsWith(".active.jsonl"))).toBe(false);

    const archives = files
      .filter((file) => file.endsWith(".jsonl.gz"))
      .map((file) =>
        gunzipSync(fs.readFileSync(joinPath(runsDir, file))).toString("utf8"),
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

    expect(fs.existsSync(joinPath(dataPath(tmpDir), "context.jsonl"))).toBe(false);
    expect(fs.existsSync(joinPath(tmpDir, ".ocula-audit.log"))).toBe(false);
  });
});
