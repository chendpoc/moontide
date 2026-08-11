import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../packages/agent/src/agent/agent-session.js";
import type { ObserverPhase } from "../packages/agent/src/agent/run-observers/phases.js";
import { setWorkdir } from "../packages/agent/src/config.js";
import { infraError } from "@moontide/shared/errors/factories.js";
import { setLLMProvider } from "@moontide/llm";
import { resetEventPlatform } from "../packages/agent-cli/src/log/setup.js";
import type { UserInteraction } from "@moontide/tools";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { mockLLMProvider, mockLLMResponse } from "./helpers/mock-llm.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

const LIFECYCLE_PHASES = [
  "runStart",
  "turnStart",
  "composeComplete",
  "turnEnd",
  "runEnd",
  "runFinalize",
  "runError",
] as const satisfies readonly ObserverPhase[];

let tmpDir = "";
let chatMock: ReturnType<typeof vi.fn>;
let testRuntime: ReturnType<typeof installTestRuntime>;
let phaseOrder: ObserverPhase[] = [];

const denyAllInteraction: UserInteraction = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

function trackLifecyclePhases(): void {
  phaseOrder = [];
  const sidecar = testRuntime.observerRegistry.sidecar();
  for (const phase of LIFECYCLE_PHASES) {
    sidecar.on(phase, `lifecycle-probe-${phase}`, () => {
      phaseOrder.push(phase);
    }, { order: 999 });
  }
}

function indicesOf(phase: ObserverPhase): number[] {
  return phaseOrder
    .map((entry, index) => (entry === phase ? index : -1))
    .filter((index) => index >= 0);
}

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-run-lifecycle-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
  chatMock = vi.fn();
  setLLMProvider(mockLLMProvider(chatMock));
  trackLifecyclePhases();
});

afterEach(() => {
  resetEventPlatform();
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
  setLLMProvider(undefined);
  vi.restoreAllMocks();
});

describe("run lifecycle observers", () => {
  it("pairs runStart, turnStart/turnEnd, runEnd, and runFinalize on success", async () => {
    chatMock.mockResolvedValue(mockLLMResponse([{ type: "text", text: "ok" }]));

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    await agentSession.run("hello", {
      userInteraction: denyAllInteraction,
      session: agentSession.session,
      runtime: testRuntime,
    });

    expect(phaseOrder[0]).toBe("runStart");
    expect(phaseOrder.at(-1)).toBe("runFinalize");

    const runStart = indicesOf("runStart");
    const turnStart = indicesOf("turnStart");
    const turnEnd = indicesOf("turnEnd");
    const runEnd = indicesOf("runEnd");
    const runFinalize = indicesOf("runFinalize");

    expect(runStart).toHaveLength(1);
    expect(turnStart).toHaveLength(1);
    expect(turnEnd).toHaveLength(1);
    expect(runEnd).toHaveLength(1);
    expect(runFinalize).toHaveLength(1);

    expect(runStart[0]).toBeLessThan(turnStart[0]!);
    expect(turnStart[0]).toBeLessThan(turnEnd[0]!);
    expect(turnEnd[0]).toBeLessThan(runEnd[0]!);
    expect(runEnd[0]).toBeLessThan(runFinalize[0]!);

    const composeComplete = indicesOf("composeComplete");
    expect(composeComplete).toHaveLength(1);
    expect(turnStart[0]).toBeLessThan(composeComplete[0]!);
    expect(composeComplete[0]).toBeLessThan(turnEnd[0]!);
  });

  it("pairs turnStart/turnEnd for each LLM round in a tool loop", async () => {
    chatMock
      .mockResolvedValueOnce(
        mockLLMResponse(
          [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "x" } }],
          "tool_use",
        ),
      )
      .mockResolvedValueOnce(mockLLMResponse([{ type: "text", text: "done" }]));

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    await agentSession.run("read", {
      userInteraction: { ...denyAllInteraction, approveTool: async () => true },
      session: agentSession.session,
      runtime: testRuntime,
    });

    expect(indicesOf("turnStart")).toHaveLength(2);
    expect(indicesOf("turnEnd")).toHaveLength(2);
    expect(indicesOf("runEnd")).toHaveLength(1);
  });

  it("dispatches turnEnd, runError, and runFinalize when LLM fails", async () => {
    chatMock.mockRejectedValue(infraError("provider down"));

    const agentSession = AgentSession.create(tmpDir, testRuntime);
    await expect(
      agentSession.run("fail", {
        userInteraction: denyAllInteraction,
        session: agentSession.session,
        runtime: testRuntime,
      }),
    ).rejects.toThrow();

    expect(indicesOf("turnStart")).toHaveLength(1);
    expect(indicesOf("turnEnd")).toHaveLength(1);
    expect(indicesOf("runError")).toHaveLength(1);
    expect(indicesOf("runEnd")).toHaveLength(0);
    expect(indicesOf("runFinalize")).toHaveLength(1);

    const turnEnd = indicesOf("turnEnd")[0]!;
    const runError = indicesOf("runError")[0]!;
    const runFinalize = indicesOf("runFinalize")[0]!;
    expect(turnEnd).toBeLessThan(runError);
    expect(runError).toBeLessThan(runFinalize);
  });
});
