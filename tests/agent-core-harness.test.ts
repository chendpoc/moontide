import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../apps/moontide/src/agent/agent-session.js";
import { createDefaultLoopContext } from "../apps/moontide/src/agent/deps.js";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { setLLMProvider } from "@moontide/llm";
import { sessionLogPath } from "@moontide/session";
import { parseItems, readLines } from "@moontide/session";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let chatMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-agent-core-harness-");
  setWorkdir(tmpDir);
  installTestRuntime(tmpDir);
  chatMock = vi.fn();
  setLLMProvider(mockLLMProvider(chatMock));
});

afterEach(() => {
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
  setLLMProvider(undefined);
  vi.restoreAllMocks();
});

describe("agent-core harness (M5)", () => {
  it("persists Session items in same order as a single-turn prompt", async () => {
    chatMock.mockResolvedValue(
      mockLLMResponse([{ type: "text", text: "Hello from core loop" }]),
    );

    const agentSession = AgentSession.create(tmpDir);
    const { reply, turn } = await agentSession.run(
      "hi",
      createDefaultLoopContext(agentSession.session, agentSession.runtime),
    );

    expect(reply).toBe("Hello from core loop");
    expect(turn).toBe(1);

    const items = parseItems(readLines(sessionLogPath(tmpDir, agentSession.session.sessionId)));
    const kinds = items.map((item) => item.kind);
    expect(kinds).toEqual(["user_message", "assistant_message"]);
  });
});
