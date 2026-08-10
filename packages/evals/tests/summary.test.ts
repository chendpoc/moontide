import { describe, expect, it } from "vitest";

import { summarizeComparison } from "../src/summary.js";
import type { EvalPairRecord } from "../src/types.js";

function pair(
  caseId: string,
  score: number,
  winner: "baseline" | "candidate" | "tie" = "candidate",
  category: EvalPairRecord["category"] = "deep_task",
  options: {
    expectLift?: boolean;
    featureSurface?: EvalPairRecord["featureSurface"];
    infraError?: boolean;
  } = {},
): EvalPairRecord {
  const base = {
    harnessName: "baseline",
    caseId,
    repetition: 1,
    sessionId: "s",
    reply: "a",
    turn: 1,
    items: [],
    durationMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    toolCallCount: 0,
  };
  return {
    caseId,
    category,
    gradingMode: category === "deep_task" ? "subjective" : "objective",
    featureSurface: options.featureSurface,
    expectLift: options.expectLift,
    repetition: 1,
    baseline: { ...base, harnessName: "baseline", infraError: options.infraError },
    candidate: { ...base, harnessName: "with-feature", reply: "b" },
    verdict: { score: score as EvalPairRecord["verdict"]["score"], winner, rationale: "test" },
  };
}

describe("summarizeComparison", () => {
  it("computes mean score and win rate", () => {
    const pairs = [
      pair("case-1", 5, "candidate"),
      pair("case-2", 3, "tie"),
    ];
    const summary = summarizeComparison("baseline", "with-feature", pairs);
    expect(summary.meanScore).toBe(4);
    expect(summary.winRatePct).toBe(50);
    expect(summary.improvedRatePct).toBe(50);
    expect(summary.byCategory.deep_task?.count).toBe(2);
    expect(summary.efficiency.meanDurationMs).toBe(100);
  });

  it("flags regression alerts", () => {
    const pairs = [pair("reg-1", 1, "baseline", "regression")];
    const summary = summarizeComparison("baseline", "with-feature", pairs);
    expect(summary.regressionAlerts).toHaveLength(1);
    expect(summary.regressionAlerts[0]).toContain("reg-1");
  });

  it("flags lift alerts when expectLift not met", () => {
    const pairs = [
      pair("deep-1", 3, "tie", "deep_task", { expectLift: true }),
      pair("deep-2", 5, "candidate", "deep_task", { expectLift: true }),
    ];
    const summary = summarizeComparison("baseline", "with-feature", pairs);
    expect(summary.liftAlerts).toHaveLength(1);
    expect(summary.liftAlerts[0]).toContain("deep-1");
  });

  it("aggregates byFeatureSurface", () => {
    const pairs = [
      pair("c1", 5, "candidate", "coding", { featureSurface: ["tooling"] }),
      pair("c2", 3, "tie", "coding", { featureSurface: ["context"] }),
    ];
    const summary = summarizeComparison("baseline", "with-feature", pairs);
    expect(summary.byFeatureSurface.tooling?.count).toBe(1);
    expect(summary.byFeatureSurface.context?.count).toBe(1);
  });

  it("tracks infra failures separately from scored pairs", () => {
    const pairs = [
      pair("infra-1", 3, "tie", "coding", { infraError: true }),
      pair("ok-1", 5, "candidate", "coding"),
    ];
    const summary = summarizeComparison("baseline", "with-feature", pairs);
    expect(summary.infraFailures).toHaveLength(1);
    expect(summary.pairedCount).toBe(2);
    expect(summary.incompletePairs).toBe(1);
    expect(summary.meanScore).toBe(5);
  });
});
