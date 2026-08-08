import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../apps/moontide/src/agent/agent-session.js";
import { getLastManifest, resetRuntimeStatus } from "../apps/moontide/src/agent/context-status.js";
import { applyDeepPromptGate } from "../apps/moontide/src/agent/deep-mode.js";
import { createDefaultLoopContext } from "../apps/moontide/src/agent/deps.js";
import { SYNTHESIZE_PROTOCOL_REMINDER_TEXT } from "../apps/moontide/src/agent/deep-task-protocol.js";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { setupAgentEventPipeline } from "../apps/moontide/src/app/bootstrap.js";
import { resetEventPlatform } from "../apps/moontide/src/log/setup.js";
import { setLLMProvider } from "@moontide/llm";
import type { UserInteraction } from "@moontide/tools";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
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

describe("AgentRun synthesize protocol reminder", () => {
  let workdir: string;
  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("MOONTIDE_ENV", "production");
    workdir = createTmpWorkdir("moontide-deep-synth-reminder-");
    setWorkdir(workdir);
    resetRuntimeStatus();
    const runtime = installTestRuntime(workdir);
    setupAgentEventPipeline(runtime);
    chatMock = vi.fn();
    setLLMProvider(mockLLMProvider(chatMock));
  });

  afterEach(() => {
    removeTmpWorkdir(workdir);
    resetEventPlatform();
    clearTestRuntime();
    setLLMProvider(undefined);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("appends one synthesize protocol reminder when ending without decision", async () => {
    chatMock
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "first attempt" }]))
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "final answer" }]));

    const agentSession = AgentSession.create(workdir);
    const sessionId = agentSession.session.sessionId;
    const gate = applyDeepPromptGate("deep: pick a cache", sessionId);
    agentSession.runtime.tools.refresh();

    const result = await agentSession.run(gate.prompt, runContext(agentSession));

    expect(result.reply).toBe("final answer");
    expect(chatMock).toHaveBeenCalledTimes(2);

    const secondRequest = chatMock.mock.calls[1]![0] as {
      messages?: { role: string; content: unknown }[];
    };
    const reminderInMessages = secondRequest.messages?.some(
      (message) =>
        message.role === "user"
        && typeof message.content === "string"
        && message.content.includes(SYNTHESIZE_PROTOCOL_REMINDER_TEXT),
    );
    expect(reminderInMessages).toBe(true);

    const items = await agentSession.session.readItems();
    expect(
      items.some(
        (item) => item.kind === "protocol_reminder" && item.reminderKind === "synthesize",
      ),
    ).toBe(true);
  });

  it("records synthesizeSkipped on manifest when still no decision after reminder", async () => {
    chatMock
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "first attempt" }]))
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "still no decision" }]));

    const agentSession = AgentSession.create(workdir);
    const sessionId = agentSession.session.sessionId;
    const gate = applyDeepPromptGate("deep: explain redis", sessionId);
    agentSession.runtime.tools.refresh();

    await agentSession.run(gate.prompt, runContext(agentSession));

    expect(getLastManifest()?.deepTask?.synthesizeSkipped).toBe(true);
  });
});
