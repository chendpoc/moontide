import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../src/agent/agent-session.js";
import { createSessionCommitPort } from "../src/agent/session-commit-port.js";
import { setWorkdir } from "../src/config.js";
import { RUNS_DIR } from "../src/constants/storage.js";
import { setLLMProvider } from "../src/llm/provider.js";
import { setupAgentEventPipeline } from "../src/app/bootstrap.js";
import { resetEventPlatform } from "../src/log/setup.js";
import { getRunId, resetRun } from "../src/log/run.js";
import { Session } from "../src/session/session.js";
import { createAgentEventDeriveHandler } from "../src/plugins/builtin/log-sync/index.js";
import { sessionLogPath } from "../src/session/paths.js";
import { dataPath, joinPath } from "../src/utils/path.js";
import type { UserInteraction } from "../src/tools/types.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let chatMock: ReturnType<typeof vi.fn>;
let testRuntime: ReturnType<typeof installTestRuntime>;

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

function readSealedRunEvents(workdir: string): Array<{ kind: string; channel: string }> {
  const runsDir = dataPath(workdir, RUNS_DIR);
  const archive = fs
    .readdirSync(runsDir)
    .find((file) => file.endsWith(".jsonl.gz") && file.startsWith(getRunId()));
  expect(archive).toBeDefined();
  const raw = gunzipSync(fs.readFileSync(joinPath(runsDir, archive!))).toString("utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; channel: string });
}

function countEvent(
  events: Array<{ kind: string; channel: string }>,
  channel: string,
  kind: string,
): number {
  return events.filter((event) => event.channel === channel && event.kind === kind).length;
}

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-log-sync-");
  setWorkdir(tmpDir);
  resetRun("run-test");
  testRuntime = installTestRuntime(tmpDir);
  setupAgentEventPipeline(testRuntime);
  chatMock = vi.fn();
  setLLMProvider(mockLLMProvider(chatMock));
});

afterEach(() => {
  resetEventPlatform();
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
  setLLMProvider(undefined);
  vi.restoreAllMocks();
});

describe("session item commit path", () => {
  it("writes session jsonl via commit port", async () => {
    const session = Session.create(tmpDir, createSessionCommitPort(tmpDir, testRuntime));
    await session.appendUser(1, "hello");

    expect(fs.existsSync(sessionLogPath(tmpDir, session.sessionId))).toBe(true);
    const log = await session.readItems();
    expect(log).toHaveLength(1);
  });

  it("derives conversation user_prompt from session item", async () => {
    testRuntime.hookRegistry.sidecar().on("sessionItem", "agent-event-derive", createAgentEventDeriveHandler());

    const session = Session.create(tmpDir, createSessionCommitPort(tmpDir, testRuntime));
    await session.appendUser(1, "derived prompt");

    const activePath = dataPath(tmpDir, RUNS_DIR, `${getRunId()}.active.jsonl`);
    const lines = fs.readFileSync(activePath, "utf8").trim().split("\n");
    const kinds = lines.map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toContain("user_prompt");
  });
});

describe("agent event deduplication", () => {
  it("emits one conversation and trace event per session commit on full run", async () => {
    chatMock.mockResolvedValue(
      mockLLMResponse([{ type: "text", text: "Hello from model" }]),
    );

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    await agentSession.run("hi there", {
      userInteraction: denyAllInteraction,
      session: agentSession.session,
      runtime: testRuntime,
    });

    const events = readSealedRunEvents(tmpDir);
    expect(countEvent(events, "conversation", "user_prompt")).toBe(1);
    expect(countEvent(events, "conversation", "final")).toBe(1);
    expect(countEvent(events, "trace", "assistant_text")).toBe(1);
  });

  it("does not duplicate tool trace events when tool loop completes", async () => {
    fs.writeFileSync(joinPath(tmpDir, "demo.txt"), "file content", "utf8");
    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
          [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "demo.txt" } }],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "done reading" }]));

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    await agentSession.run("read demo", {
      userInteraction: { ...denyAllInteraction, approveTool: async () => true },
      session: agentSession.session,
      runtime: testRuntime,
    });

    const events = readSealedRunEvents(tmpDir);
    expect(countEvent(events, "conversation", "user_prompt")).toBe(1);
    expect(countEvent(events, "trace", "tool_use")).toBe(1);
    expect(countEvent(events, "trace", "tool_result")).toBe(1);
    expect(countEvent(events, "conversation", "final")).toBe(1);
    expect(countEvent(events, "tool_use_log", "tool_use")).toBe(1);
  });
});
