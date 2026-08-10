import { describe, expect, it } from "vitest";

import { FEATURE_PR_HELP, featurePrSteps, parseFeaturePrArgs } from "../src/feature-pr.js";
import { formatFeaturePrImpactMarkdown, mergeGateReasons } from "../src/feature-pr-impact.js";
import {
  FEATURE_PR_GUARD_SUITE,
  FEATURE_PR_PRIMARY_PLAN,
  featurePrPrimaryPlan,
  listFeatureSurfaces,
} from "../src/feature-pr-plan.js";
import type { CompareSummary, EvalReport } from "../src/types.js";

describe("featurePrSteps", () => {
  it("maps deep_protocol to regression guard + deep_task primary", () => {
    const steps = featurePrSteps("deep_protocol");
    expect(steps).toEqual([
      { label: "guard", suitePath: FEATURE_PR_GUARD_SUITE },
      { label: "primary", suitePath: "v2/deep_task", featureSurface: "deep_protocol" },
    ]);
  });

  it("maps tooling to coding primary", () => {
    const steps = featurePrSteps("tooling");
    expect(steps[1]).toEqual({
      label: "primary",
      suitePath: "v2/coding",
      featureSurface: "tooling",
    });
  });
});

describe("feature-pr-plan", () => {
  it("lists all feature surfaces", () => {
    expect(listFeatureSurfaces()).toEqual(Object.keys(FEATURE_PR_PRIMARY_PLAN));
  });

  it("returns primary plan for each surface", () => {
    const plan = featurePrPrimaryPlan("model_only");
    expect(plan.suitePath).toBe("v2/general");
    expect(plan.featureSurface).toBe("model_only");
  });
});

describe("parseFeaturePrArgs", () => {
  it("returns help for --help", () => {
    expect(parseFeaturePrArgs(["--help"])).toBe("help");
    expect(parseFeaturePrArgs(["-h"])).toBe("help");
  });

  it("returns list-surfaces for --list-surfaces", () => {
    expect(parseFeaturePrArgs(["--list-surfaces"])).toBe("list-surfaces");
  });

  it("requires feature-surface", () => {
    expect(() => parseFeaturePrArgs([])).toThrow(/feature-surface/);
  });

  it("rejects unknown feature-surface", () => {
    expect(() => parseFeaturePrArgs(["--feature-surface=unknown"])).toThrow(/Unknown feature surface/);
  });

  it("defaults repetitions to 1 and merge-gate on", () => {
    const args = parseFeaturePrArgs(["--feature-surface=deep_protocol"]);
    if (args === "help" || args === "list-surfaces") {
      throw new Error("expected options");
    }
    expect(args.repetitions).toBe(1);
    expect(args.mergeGate).toBe(true);
    expect(args.writeImpact).toBe(true);
    expect(args.featureSurface).toBe("deep_protocol");
  });

  it("parses verbose, log path, and no-write-impact", () => {
    const args = parseFeaturePrArgs([
      "--feature-surface=tooling",
      "--verbose",
      "--log=/tmp/eval.log",
      "--no-merge-gate",
      "--no-write-impact",
      "--agent-concurrency=6",
    ]);
    if (args === "help" || args === "list-surfaces") {
      throw new Error("expected options");
    }
    expect(args.verbose).toBe(true);
    expect(args.logPath).toBe("/tmp/eval.log");
    expect(args.mergeGate).toBe(false);
    expect(args.writeImpact).toBe(false);
    expect(args.agentConcurrency).toBe(6);
  });
});

describe("formatFeaturePrImpactMarkdown", () => {
  const efficiency = {
    meanDurationMs: 1000,
    meanToolCalls: 2,
    meanInputTokens: 120,
    meanOutputTokens: 60,
  };

  const compare: CompareSummary = {
    baselineName: "baseline",
    candidateName: "with-feature",
    pairedCount: 10,
    incompletePairs: 0,
    meanScore: 3.8,
    winRatePct: 60,
    improvedRatePct: 55,
    regressionAlerts: [],
    liftAlerts: ["case-a: candidate worse"],
    infraFailures: [],
    byCategory: {},
    byGradingMode: {},
    byFeatureSurface: {},
    efficiency,
  };

  it("includes guard and primary sections", () => {
    const guardReport = { compare: { ...compare, meanScore: 3.6, liftAlerts: [] } } as unknown as EvalReport;
    const primaryReport = { compare, artifactDir: "/tmp/runs/primary_abc" } as unknown as EvalReport;
    const md = formatFeaturePrImpactMarkdown(
      "deep_protocol",
      [
        { step: { label: "guard" }, report: { ...guardReport, artifactDir: "/tmp/runs/guard_xyz" } },
        { step: { label: "primary" }, report: primaryReport },
      ],
      false,
    );
    expect(md).toContain("## Eval Impact");
    expect(md).toContain("deep_protocol");
    expect(md).toContain("Guard (`v2/regression`)");
    expect(md).toContain("Primary");
    expect(md).toContain("liftAlerts:");
    expect(md).toContain("case-a: candidate worse");
    expect(md).toContain("merge-gate:** PASS");
  });
});

describe("mergeGateReasons", () => {
  it("collects failure reasons from steps", () => {
    const lowScore: CompareSummary = {
      baselineName: "baseline",
      candidateName: "with-feature",
      pairedCount: 5,
      incompletePairs: 0,
      meanScore: 3.0,
      winRatePct: 40,
      improvedRatePct: 30,
      regressionAlerts: ["reg-1"],
      liftAlerts: ["lift-1"],
      infraFailures: [],
      byCategory: {},
      byGradingMode: {},
      byFeatureSurface: {},
      efficiency: {
        meanDurationMs: 500,
        meanToolCalls: 1,
        meanInputTokens: 50,
        meanOutputTokens: 25,
      },
    };
    const reasons = mergeGateReasons([
      {
        step: { label: "guard" },
        report: { compare: lowScore } as EvalReport,
      },
    ]);
    expect(reasons.some((r) => r.includes("meanScore"))).toBe(true);
    expect(reasons.some((r) => r.includes("regression"))).toBe(true);
    expect(reasons.some((r) => r.includes("lift"))).toBe(true);
  });
});

describe("FEATURE_PR_HELP", () => {
  it("documents eval:feature as PR entry", () => {
    expect(FEATURE_PR_HELP).toContain("pnpm eval:feature");
    expect(FEATURE_PR_HELP).toContain("--list-surfaces");
  });
});
