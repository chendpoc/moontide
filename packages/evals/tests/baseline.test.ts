import { describe, expect, it } from "vitest";

import { compareToBaseline, shouldFailMergeGate } from "../src/baseline.js";
import type { CompareSummary } from "../src/types.js";

function summary(overrides: Partial<CompareSummary> = {}): CompareSummary {
  return {
    baselineName: "baseline",
    candidateName: "with-feature",
    pairedCount: 2,
    incompletePairs: 0,
    meanScore: 4,
    winRatePct: 50,
    improvedRatePct: 50,
    byCategory: {},
    byGradingMode: {},
    byFeatureSurface: {},
    efficiency: {
      meanDurationMs: 100,
      meanToolCalls: 1,
      meanInputTokens: 10,
      meanOutputTokens: 5,
    },
    regressionAlerts: [],
    liftAlerts: [],
    infraFailures: [],
    ...overrides,
  };
}

describe("compareToBaseline", () => {
  it("computes mean score delta", () => {
    const delta = compareToBaseline(summary({ meanScore: 4.2 }), summary({ meanScore: 3.8 }));
    expect(delta.meanScoreDelta).toBeCloseTo(0.4);
  });
});

describe("shouldFailMergeGate", () => {
  it("fails when mean score below threshold", () => {
    expect(shouldFailMergeGate(summary({ meanScore: 3.0 }))).toBe(true);
  });

  it("fails on regression alerts", () => {
    expect(shouldFailMergeGate(summary({ regressionAlerts: ["x"] }))).toBe(true);
  });

  it("fails on lift alerts", () => {
    expect(shouldFailMergeGate(summary({ liftAlerts: ["x"] }))).toBe(true);
  });

  it("passes clean summary", () => {
    expect(shouldFailMergeGate(summary())).toBe(false);
  });
});
