import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BaselineDelta, BaselineSnapshot, CompareSummary } from "./types.js";

export const MERGE_GATE_MIN_MEAN_SCORE = 3.5;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_BASELINE_PATH = path.join(packageRoot, "baseline.json");

export function loadBaseline(filePath = DEFAULT_BASELINE_PATH): BaselineSnapshot | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BaselineSnapshot;
}

export function writeBaseline(
  compare: CompareSummary,
  meta: { suiteVersion: string; gitSha: string },
  filePath = DEFAULT_BASELINE_PATH,
): void {
  const snapshot: BaselineSnapshot = {
    suiteVersion: meta.suiteVersion,
    gitSha: meta.gitSha,
    recordedAt: new Date().toISOString(),
    compare,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export function compareToBaseline(
  current: CompareSummary,
  baseline: CompareSummary,
): BaselineDelta {
  const byCategoryDelta: BaselineDelta["byCategoryDelta"] = {};
  for (const [category, stats] of Object.entries(current.byCategory)) {
    const base = baseline.byCategory[category as keyof typeof baseline.byCategory];
    if (base) {
      byCategoryDelta[category as keyof typeof byCategoryDelta] = {
        meanScoreDelta: stats.meanScore - base.meanScore,
      };
    }
  }

  return {
    meanScoreDelta: current.meanScore - baseline.meanScore,
    winRateDeltaPct: current.winRatePct - baseline.winRatePct,
    byCategoryDelta,
  };
}

export function shouldFailMergeGate(compare: CompareSummary): boolean {
  if (compare.meanScore < MERGE_GATE_MIN_MEAN_SCORE) {
    return true;
  }
  if (compare.regressionAlerts.length > 0) {
    return true;
  }
  if (compare.liftAlerts.length > 0) {
    return true;
  }
  return false;
}
