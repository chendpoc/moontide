import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../packages/agent/src/agent/agent-session.js";
import { continueReplAgent } from "../packages/agent/src/agent/loop.js";
import { getWorkdir, setWorkdir } from "../packages/agent/src/config.js";
import { setupAgentEventPipeline } from "../packages/agent/src/app/bootstrap.js";
import { createCliEventPipeline } from "../packages/agent-cli/src/log/cli-event-pipeline.js";
import { resetEventPlatform } from "../packages/agent-cli/src/log/setup.js";
import { setLLMProvider } from "@moontide/llm";
import type { UserInteraction } from "@moontide/tools";
import { dataPath, joinPath } from "@moontide/shared/utils/path.js";
import { RUNS_DIR } from "@moontide/shared/constants/storage.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let originalWorkdir = "";
let chatMock: ReturnType<typeof vi.fn>;
let testRuntime: ReturnType<typeof installTestRuntime>;

const interaction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => [],
};

beforeEach(() => {
  originalWorkdir = getWorkdir();
  tmpDir = createTmpWorkdir("moontide-run-storage-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
  setupAgentEventPipeline(testRuntime, createCliEventPipeline(tmpDir), tmpDir);
  chatMock = vi.fn();
  setLLMProvider(mockLLMProvider(chatMock));
});

afterEach(() => {
  resetEventPlatform();
  clearTestRuntime();
  setWorkdir(originalWorkdir);
  removeTmpWorkdir(tmpDir);
  setLLMProvider(undefined);
  vi.restoreAllMocks();
});

describe("run storage integration", () => {
  it("seals each run and does not carry prior conversation context forward", async () => {
    chatMock
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "first reply" }]))
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "second reply" }]));

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    const loopContext = {
      userInteraction: interaction,
      session: agentSession.session,
      runtime: testRuntime,
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
    expect(fs.existsSync(joinPath(tmpDir, ".moontide-audit.log"))).toBe(false);
  });
});
