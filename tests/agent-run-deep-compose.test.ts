import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../src/agent/agent-session.js";
import { applyDeepPromptGate } from "../src/agent/deep-mode.js";
import { createDefaultLoopContext } from "../src/agent/deps.js";
import { setWorkdir } from "../src/config.js";
import { setupAgentEventPipeline } from "../src/app/bootstrap.js";
import { resetEventPlatform } from "../src/log/setup.js";
import { setLLMProvider } from "../src/llm/provider.js";
import type { UserInteraction } from "../src/tools/types.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

function runContext(agentSession: AgentSession): ReturnType<typeof createDefaultLoopContext> {
  return {
    ...createDefaultLoopContext(agentSession.session, agentSession.runtime),
    userInteraction: denyAllInteraction,
  };
}

describe("AgentRun deep mode compose path", () => {
  let workdir: string;
  let chatMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("MOONTIDE_ENV", "production");
    workdir = createTmpWorkdir("moontide-agent-run-deep-");
    setWorkdir(workdir);
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

  it("injects Working Set into LLM system via AgentSession.run (composeForSession)", async () => {
    chatMock
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "ok" }]))
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "ok" }]));

    const agentSession = AgentSession.create(workdir);
    const sessionId = agentSession.session.sessionId;
    const gate = applyDeepPromptGate("deep: trace auth regression", sessionId);
    expect(gate.deepActivated).toBe(true);
    agentSession.runtime.tools.refresh();

    await agentSession.run(gate.prompt, runContext(agentSession));

    expect(chatMock).toHaveBeenCalledTimes(2);
    const request = chatMock.mock.calls[0]![0] as { system?: string };
    expect(request.system).toContain("## Deep Task Mode (active)");
    expect(request.system).toContain("trace auth regression");
    expect(request.system).toContain("## Working set (Deep Task Mode)");
    expect(request.system).toContain("Open questions");
  });
});
