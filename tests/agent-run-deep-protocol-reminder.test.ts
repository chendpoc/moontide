import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../apps/moontide/src/agent/agent-session.js";
import { resetRuntimeStatus } from "../apps/moontide/src/agent/context-status.js";
import { applyDeepPromptGate } from "../apps/moontide/src/agent/deep-mode.js";
import { createDefaultLoopContext } from "../apps/moontide/src/agent/deps.js";
import { ORIENT_PROTOCOL_REMINDER_TEXT } from "../apps/moontide/src/agent/deep-task-protocol.js";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { setupAgentEventPipeline } from "../apps/moontide/src/app/bootstrap.js";
import { resetEventPlatform } from "../apps/moontide/src/log/setup.js";
import { setLLMProvider } from "@moontide/llm";
import { TOOL_NAMES } from "@moontide/tools";
import type { UserInteraction } from "@moontide/tools";
import { joinPath } from "@moontide/shared/utils/path.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

const allowAllInteraction: UserInteraction = {
  approveTool: async () => true,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

function runContext(agentSession: AgentSession) {
  return {
    ...createDefaultLoopContext(agentSession.session, agentSession.runtime),
    userInteraction: allowAllInteraction,
  };
}

describe("AgentRun orient protocol reminder", () => {
  let workdir: string;
  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("MOONTIDE_ENV", "production");
    workdir = createTmpWorkdir("moontide-deep-orient-reminder-");
    setWorkdir(workdir);
    resetRuntimeStatus();
    const runtime = installTestRuntime(workdir);
    setupAgentEventPipeline(runtime);
    chatMock = vi.fn();
    setLLMProvider(mockLLMProvider(chatMock));
    fs.writeFileSync(joinPath(workdir, "demo.txt"), "hello", "utf8");
  });

  afterEach(() => {
    removeTmpWorkdir(workdir);
    resetEventPlatform();
    clearTestRuntime();
    setLLMProvider(undefined);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("appends one orient protocol reminder when turn 1 skips work_mem", async () => {
    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
          [
            {
              type: "tool_use",
              id: "tu_1",
              name: TOOL_NAMES.READ_FILE,
              input: { path: "demo.txt" },
            },
          ],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "done" }]))
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "done" }]));

    const agentSession = AgentSession.create(workdir);
    const sessionId = agentSession.session.sessionId;
    const gate = applyDeepPromptGate("deep: read demo", sessionId);
    agentSession.runtime.tools.refresh();

    await agentSession.run(gate.prompt, runContext(agentSession));

    expect(chatMock).toHaveBeenCalledTimes(3);
    const secondRequest = chatMock.mock.calls[1]![0] as {
      messages?: { role: string; content: unknown }[];
    };
    const reminderInMessages = secondRequest.messages?.some(
      (message) =>
        message.role === "user"
        && typeof message.content === "string"
        && message.content.includes(ORIENT_PROTOCOL_REMINDER_TEXT),
    );
    expect(reminderInMessages).toBe(true);

    const items = await agentSession.session.readItems();
    expect(items.some((item) => item.kind === "protocol_reminder")).toBe(true);
  });
});
