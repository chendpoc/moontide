import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../apps/moontide/src/agent/agent-session.js";
import { createDefaultLoopContext } from "../apps/moontide/src/agent/deps.js";
import type { LoopContext } from "../apps/moontide/src/agent/deps.js";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { setupAgentEventPipeline } from "../apps/moontide/src/app/bootstrap.js";
import { resetEventPlatform } from "../apps/moontide/src/log/setup.js";
import { setLLMProvider } from "@moontide/llm";
import type { UserInteraction } from "@moontide/tools";
import { sessionLogPath } from "@moontide/session";
import { joinPath } from "@moontide/shared/utils/path.js";
import { resetAlwaysAllowOverride } from "../apps/moontide/src/tools/always-allow-mode.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let chatMock: ReturnType<typeof vi.fn>;
let testRuntime: ReturnType<typeof installTestRuntime>;

function runContext(
  agentSession: AgentSession,
  userInteraction: UserInteraction,
): LoopContext {
  return {
    userInteraction,
    session: agentSession.session,
    runtime: agentSession.runtime,
  };
}

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

beforeEach(() => {
  vi.stubEnv("MOONTIDE_ENV", "production");
  delete process.env.MOONTIDE_ALWAYS_ALLOW;
  resetAlwaysAllowOverride();
  tmpDir = createTmpWorkdir("moontide-agent-run-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
  setupAgentEventPipeline(testRuntime);
  chatMock = vi.fn();
  setLLMProvider(mockLLMProvider(chatMock));
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
  resetEventPlatform();
  clearTestRuntime();
  setLLMProvider(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AgentSession.run", () => {
  it("returns assistant text when stop_reason is end_turn", async () => {
    chatMock.mockResolvedValue(
      mockLLMResponse([{ type: "text", text: "Hello from model" }]),
    );

    const agentSession = AgentSession.create(tmpDir);
    const { reply, turn } = await agentSession.run(
      "hi",
      runContext(agentSession, denyAllInteraction),
    );

    expect(reply).toBe("Hello from model");
    expect(turn).toBe(1);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it("runs tool_use and continues until end_turn", async () => {
    fs.writeFileSync(joinPath(tmpDir, "demo.txt"), "file content", "utf8");

    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
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
        mockLLMResponse([{ type: "text", text: "Read complete" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    const { reply, turn } = await agentSession.run(
      "read demo.txt",
      runContext(agentSession, denyAllInteraction),
    );

    expect(reply).toBe("Read complete");
    expect(turn).toBe(2);
    expect(chatMock).toHaveBeenCalledTimes(2);
    const log = await agentSession.session.readItems();
    expect(log.some((r) => r.kind === "tool_outcome")).toBe(true);
  });

  it("blocks deny-class tools via Tool Use Module", async () => {
    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
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
        mockLLMResponse([{ type: "text", text: "Acknowledged deny" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "run bad command",
      runContext(agentSession, denyAllInteraction),
    );

    const log = await agentSession.session.readItems();
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

    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
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
        mockLLMResponse([{ type: "text", text: "User declined" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "delete foo",
      runContext(agentSession, interaction),
    );

    const log = await agentSession.session.readItems();
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

    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
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
        mockLLMResponse([{ type: "text", text: "Done" }]),
      );

    const agentSession = AgentSession.create(tmpDir);
    await agentSession.run(
      "echo",
      runContext(agentSession, interaction),
    );

    const log = await agentSession.session.readItems();
    const outcome = log.find((r) => r.kind === "tool_outcome");
    if (outcome?.kind === "tool_outcome") {
      expect(outcome.resultSummary.summary).toContain("approved");
    }
  });

  it("writes session log during run", async () => {
    chatMock.mockResolvedValue(
      mockLLMResponse([{ type: "text", text: "Logged reply" }]),
    );

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    await agentSession.run(
      "log me",
      createDefaultLoopContext(agentSession.session, testRuntime),
    );

    expect(fs.existsSync(sessionLogPath(tmpDir, agentSession.session.sessionId))).toBe(true);
    const log = await agentSession.session.readItems();
    expect(log.some((r) => r.kind === "user_message")).toBe(true);
    expect(log.some((r) => r.kind === "assistant_message")).toBe(true);
  });
});
