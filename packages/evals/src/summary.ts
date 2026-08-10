import type {
  CategorySummary,
  CompareSummary,
  EfficiencySummary,
  EvalCaseCategory,
  EvalGradingMode,
  EvalPairRecord,
  EvalRunOutput,
  FeatureSurface,
} from "./types.js";
import { FEATURE_SURFACES } from "./types.js";
import { efficiencyFromOutput } from "./graders/efficiency-checks.js";

function _mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function _categorySummary(pairs: EvalPairRecord[]): CategorySummary {
  if (pairs.length === 0) {
    return { meanScore: 0, count: 0, winRatePct: 0 };
  }
  const wins = pairs.filter((pair) => pair.verdict.winner === "candidate").length;
  return {
    meanScore: _mean(pairs.map((pair) => pair.verdict.score)),
    count: pairs.length,
    winRatePct: (wins / pairs.length) * 100,
  };
}

function _efficiencySummary(outputs: EvalRunOutput[]): EfficiencySummary {
  if (outputs.length === 0) {
    return {
      meanDurationMs: 0,
      meanToolCalls: 0,
      meanInputTokens: 0,
      meanOutputTokens: 0,
    };
  }
  const metrics = outputs.map(efficiencyFromOutput);
  return {
    meanDurationMs: _mean(metrics.map((m) => m.durationMs)),
    meanToolCalls: _mean(metrics.map((m) => m.toolCallCount)),
    meanInputTokens: _mean(metrics.map((m) => m.inputTokens)),
    meanOutputTokens: _mean(metrics.map((m) => m.outputTokens)),
  };
}

/** Compare baseline vs candidate from graded pair records. */
export function summarizeComparison(
  baselineName: string,
  candidateName: string,
  pairs: EvalPairRecord[],
): CompareSummary {
  const infraFailures = pairs
    .filter((pair) => pair.baseline.infraError || pair.candidate.infraError)
    .map((pair) => {
      const side = pair.baseline.infraError ? "baseline" : "candidate";
      const err = pair.baseline.infraError ? pair.baseline.error : pair.candidate.error;
      return `${pair.caseId} (rep ${pair.repetition}, ${side}): ${err ?? "infra error"}`;
    });

  const scored = pairs.filter(
    (pair) =>
      !pair.baseline.infraError &&
      !pair.candidate.infraError &&
      !pair.baseline.error &&
      !pair.candidate.error,
  );
  const incompletePairs = pairs.length - scored.length;

  const scores = scored.map((pair) => pair.verdict.score);
  const wins = scored.filter((pair) => pair.verdict.winner === "candidate").length;
  const improved = scored.filter((pair) => pair.verdict.score >= 4).length;

  const byCategory: Partial<Record<EvalCaseCategory, CategorySummary>> = {};
  for (const category of [
    "coding",
    "deep_task",
    "general",
    "regression",
    "exploration",
    "external_research",
  ] as EvalCaseCategory[]) {
    const subset = scored.filter((pair) => pair.category === category);
    if (subset.length > 0) {
      byCategory[category] = _categorySummary(subset);
    }
  }

  const byGradingMode: Partial<Record<EvalGradingMode, CategorySummary>> = {};
  for (const mode of ["objective", "subjective"] as EvalGradingMode[]) {
    const subset = scored.filter((pair) => pair.gradingMode === mode);
    if (subset.length > 0) {
      byGradingMode[mode] = _categorySummary(subset);
    }
  }

  const byFeatureSurface: Partial<Record<FeatureSurface, CategorySummary>> = {};
  for (const surface of FEATURE_SURFACES) {
    const subset = scored.filter((pair) => pair.featureSurface?.includes(surface));
    if (subset.length > 0) {
      byFeatureSurface[surface] = _categorySummary(subset);
    }
  }

  const regressionAlerts = scored
    .filter((pair) => pair.category === "regression" && pair.verdict.score <= 2)
    .map((pair) => `${pair.caseId} (rep ${pair.repetition}): score=${pair.verdict.score}`);

  const liftAlerts = scored
    .filter(
      (pair) =>
        pair.expectLift &&
        (pair.verdict.score <= 3 || pair.verdict.winner !== "candidate"),
    )
    .map(
      (pair) =>
        `${pair.caseId} (rep ${pair.repetition}): expected lift, score=${pair.verdict.score} winner=${pair.verdict.winner}`,
    );

  const candidateOutputs = scored.map((pair) => pair.candidate);

  return {
    baselineName,
    candidateName,
    pairedCount: pairs.length,
    incompletePairs,
    meanScore: _mean(scores),
    winRatePct: scored.length > 0 ? (wins / scored.length) * 100 : 0,
    improvedRatePct: scored.length > 0 ? (improved / scored.length) * 100 : 0,
    byCategory,
    byGradingMode,
    byFeatureSurface,
    efficiency: _efficiencySummary(candidateOutputs),
    regressionAlerts,
    liftAlerts,
    infraFailures,
  };
}

export function formatCompareSummary(summary: CompareSummary): string {
  const lines = [
    `Eval: ${summary.baselineName} vs ${summary.candidateName}`,
    `  pairs: ${summary.pairedCount} (incomplete: ${summary.incompletePairs})`,
    `  mean score: ${summary.meanScore.toFixed(2)} / 5`,
    `  candidate wins: ${summary.winRatePct.toFixed(1)}% | score>=4: ${summary.improvedRatePct.toFixed(1)}%`,
    `  efficiency: ${summary.efficiency.meanDurationMs.toFixed(0)}ms avg | tools ${summary.efficiency.meanToolCalls.toFixed(1)} | tokens in ${summary.efficiency.meanInputTokens.toFixed(0)} out ${summary.efficiency.meanOutputTokens.toFixed(0)}`,
  ];

  const catParts = Object.entries(summary.byCategory).map(
    ([cat, stats]) => `${cat} ${stats.meanScore.toFixed(1)} (n=${stats.count})`,
  );
  if (catParts.length > 0) {
    lines.push(`  by category: ${catParts.join(", ")}`);
  }

  const surfaceParts = Object.entries(summary.byFeatureSurface).map(
    ([surface, stats]) => `${surface} ${stats.meanScore.toFixed(1)} (n=${stats.count})`,
  );
  if (surfaceParts.length > 0) {
    lines.push(`  by featureSurface: ${surfaceParts.join(", ")}`);
  }

  if (summary.regressionAlerts.length > 0) {
    lines.push(`  regression alerts: ${summary.regressionAlerts.join("; ")}`);
  }

  if (summary.liftAlerts.length > 0) {
    lines.push(`  lift alerts: ${summary.liftAlerts.join("; ")}`);
  }

  if (summary.infraFailures.length > 0) {
    lines.push(`  infra failures: ${summary.infraFailures.join("; ")}`);
  }

  return lines.join("\n");
}
