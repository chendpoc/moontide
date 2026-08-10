import { describe, expect, it, vi } from "vitest";

import * as agentWorker from "../src/agent-worker.js";
import { runSuiteAbWithGate } from "../src/runner.js";
import * as suiteLoader from "../src/suite-loader.js";

describe("runSuiteAbWithGate", () => {
  it("writes agent-only pairs without judge", async () => {
    vi.spyOn(suiteLoader, "loadSuite").mockReturnValue({
      version: "2",
      cases: [
        {
          id: "case-a",
          category: "regression",
          gradingMode: "objective",
          featureSurface: ["model_only"],
          steps: [{ type: "prompt", content: "hi" }],
          expectedChecks: [{ kind: "reply_contains", value: "hi" }],
        },
      ],
    });
    vi.spyOn(agentWorker, "spawnAgentJob").mockResolvedValue({
      caseId: "case-a",
      caseDef: {
        id: "case-a",
        category: "regression",
        gradingMode: "objective",
        steps: [{ type: "prompt", content: "hi" }],
      },
      baseline: {
        harnessName: "baseline",
        caseId: "case-a",
        repetition: 1,
        sessionId: "s",
        reply: "hi",
        turn: 1,
        items: [],
        durationMs: 1,
        inputTokens: 0,
        outputTokens: 0,
        toolCallCount: 0,
      },
      candidate: {
        harnessName: "candidate",
        caseId: "case-a",
        repetition: 1,
        sessionId: "s2",
        reply: "hi",
        turn: 1,
        items: [],
        durationMs: 1,
        inputTokens: 0,
        outputTokens: 0,
        toolCallCount: 0,
      },
    });

    const { report, mergeGateFailed } = await runSuiteAbWithGate({
      suitePath: "v2/regression",
      baseline: { name: "baseline", disableProtocolReminders: true },
      candidate: { name: "with-feature" },
      phase: "agent-only",
      artifactBaseDir: "/tmp/moontide-eval-test-runs",
      agentConcurrency: 1,
    });

    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]?.phase).toBe("agent-only");
    expect(report.compare).toBeUndefined();
    expect(mergeGateFailed).toBe(false);

    vi.restoreAllMocks();
  });
});
