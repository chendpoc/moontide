import fs from "node:fs";
import path from "node:path";

import { gitSha } from "./artifacts.js";
import { shouldFailMergeGate } from "./baseline.js";
import type { CompareSummary, EvalReport, FeatureSurface } from "./types.js";

export interface FeaturePrImpactStep {
  label: "guard" | "primary";
}

export interface FeaturePrStepReport {
  step: FeaturePrImpactStep;
  report: EvalReport;
}

export function formatFeaturePrImpactMarkdown(
  featureSurface: FeatureSurface,
  steps: FeaturePrStepReport[],
  mergeGateFailed: boolean,
): string {
  const guard = steps.find((entry) => entry.step.label === "guard");
  const primary = steps.find((entry) => entry.step.label === "primary");
  const guardCompare = guard?.report.compare;
  const primaryCompare = primary?.report.compare;
  const primaryArtifact = primary?.report.artifactDir;
  const guardArtifact = guard?.report.artifactDir;

  const lines = [
    "## Eval Impact",
    "",
    `- **featureSurface:** \`${featureSurface}\``,
    `- **gitSha:** \`${gitSha()}\``,
    `- **merge-gate:** ${mergeGateFailed ? "FAIL" : "PASS"}`,
    "",
  ];

  if (guardCompare) {
    lines.push(
      "### Guard (`v2/regression`)",
      "",
      "| meanScore | winRate | regressionAlerts | artifact |",
      "| --- | --- | --- | --- |",
      `| ${guardCompare.meanScore.toFixed(2)} | ${guardCompare.winRatePct.toFixed(1)}% | ${guardCompare.regressionAlerts.length} | \`${guardArtifact ? path.basename(guardArtifact) : "n/a"}\` |`,
      "",
    );
    if (guardCompare.regressionAlerts.length > 0) {
      lines.push("regressionAlerts:", ...guardCompare.regressionAlerts.map((a) => `- ${a}`), "");
    }
  }

  if (primaryCompare) {
    lines.push(
      "### Primary",
      "",
      "| meanScore | winRate | liftAlerts | artifact |",
      "| --- | --- | --- | --- |",
      `| ${primaryCompare.meanScore.toFixed(2)} | ${primaryCompare.winRatePct.toFixed(1)}% | ${primaryCompare.liftAlerts.length} | \`${primaryArtifact ? path.basename(primaryArtifact) : "n/a"}\` |`,
      "",
    );
    if (primaryCompare.liftAlerts.length > 0) {
      lines.push("liftAlerts:", ...primaryCompare.liftAlerts.map((a) => `- ${a}`), "");
    }
    if (primary?.report.baselineDelta) {
      const d = primary.report.baselineDelta;
      lines.push(
        `baseline delta: meanScore ${d.meanScoreDelta >= 0 ? "+" : ""}${d.meanScoreDelta.toFixed(2)}, ` +
          `winRate ${d.winRateDeltaPct >= 0 ? "+" : ""}${d.winRateDeltaPct.toFixed(1)}%`,
        "",
      );
    }
  }

  lines.push(
    "### Checklist",
    "",
    `- [ ] ${mergeGateFailed ? "merge-gate failed" : "merge-gate passed"}`,
    `- [ ] ${guardCompare && guardCompare.regressionAlerts.length === 0 ? "no regression alerts" : "review regression alerts"}`,
    `- [ ] ${primaryCompare && primaryCompare.liftAlerts.length === 0 ? "no lift alerts" : "review lift alerts"}`,
    "",
  );

  return lines.join("\n");
}

export function writeFeaturePrImpactSnippet(
  featureSurface: FeatureSurface,
  steps: FeaturePrStepReport[],
  mergeGateFailed: boolean,
): string | undefined {
  const primaryDir = steps.find((entry) => entry.step.label === "primary")?.report.artifactDir;
  const guardDir = steps.find((entry) => entry.step.label === "guard")?.report.artifactDir;
  const targetDir = primaryDir ?? guardDir;
  if (!targetDir) {
    return undefined;
  }

  const markdown = formatFeaturePrImpactMarkdown(featureSurface, steps, mergeGateFailed);
  const outPath = path.join(targetDir, "impact-snippet.md");
  fs.writeFileSync(outPath, `${markdown}\n`, "utf8");
  return outPath;
}

export function mergeGateReasons(steps: FeaturePrStepReport[]): string[] {
  const reasons: string[] = [];
  for (const { step, report } of steps) {
    const compare = report.compare;
    if (!compare || !shouldFailMergeGate(compare)) {
      continue;
    }
    if (compare.meanScore < 3.5) {
      reasons.push(`${step.label}: meanScore ${compare.meanScore.toFixed(2)} < 3.5`);
    }
    if (compare.regressionAlerts.length > 0) {
      reasons.push(`${step.label}: ${compare.regressionAlerts.length} regression alert(s)`);
    }
    if (compare.liftAlerts.length > 0) {
      reasons.push(`${step.label}: ${compare.liftAlerts.length} lift alert(s)`);
    }
  }
  return reasons;
}

export function primaryCompareFromSteps(steps: FeaturePrStepReport[]): CompareSummary | undefined {
  return steps.find((entry) => entry.step.label === "primary")?.report.compare;
}
