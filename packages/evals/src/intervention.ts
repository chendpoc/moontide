import { execSync } from "node:child_process";

import type { MoonTideEvalHarnessConfig } from "./types.js";

/** Harness toggle A/B (same checkout, different runtime config). */
export type EvalInterventionMode = "toggle";

/** Exit code when baseline/candidate have no valid A/B difference. */
export const EVAL_EXIT_INTERVENTION_INVALID = 3;

export class EvalInterventionError extends Error {
  readonly exitCode = EVAL_EXIT_INTERVENTION_INVALID;

  constructor(message: string) {
    super(message);
    this.name = "EvalInterventionError";
  }
}

export interface ResolvedEvalIntervention {
  mode: EvalInterventionMode;
  headSha?: string;
}

export function gitRevParse(rev: string): string {
  try {
    return execSync(`git rev-parse ${rev}`, { encoding: "utf8" }).trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new EvalInterventionError(`git rev-parse failed for "${rev}": ${detail}`);
  }
}

export function gitHeadSha(): string {
  return gitRevParse("HEAD");
}

/** Effective feature toggles for diff (includes legacy disableProtocolReminders). */
export function harnessFeatureToggles(
  harness: MoonTideEvalHarnessConfig,
): Record<string, boolean> {
  const toggles: Record<string, boolean> = { ...(harness.featureToggles ?? {}) };
  if (harness.disableProtocolReminders !== undefined) {
    toggles.protocolReminders = !harness.disableProtocolReminders;
  }
  return toggles;
}

function _toggleMapsEqual(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

/** Harness fields that define an A/B difference (name alone does not count). */
export function harnessAbDiffFields(
  baseline: MoonTideEvalHarnessConfig,
  candidate: MoonTideEvalHarnessConfig,
): string[] {
  const diffs: string[] = [];

  if (baseline.model !== candidate.model) {
    diffs.push("model");
  }
  if (baseline.judgeModel !== candidate.judgeModel) {
    diffs.push("judgeModel");
  }
  if (!_toggleMapsEqual(harnessFeatureToggles(baseline), harnessFeatureToggles(candidate))) {
    diffs.push("featureToggles");
  }

  return diffs;
}

export function hasToggleIntervention(
  baseline: MoonTideEvalHarnessConfig,
  candidate: MoonTideEvalHarnessConfig,
): boolean {
  return harnessAbDiffFields(baseline, candidate).length > 0;
}

export function resolveEvalIntervention(options: {
  mode?: EvalInterventionMode;
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
  headSha?: string;
}): ResolvedEvalIntervention {
  const headSha = options.headSha ?? gitHeadSha();

  if (options.mode && options.mode !== "toggle") {
    throw new EvalInterventionError(
      "Only toggle intervention is supported. Use --harness-config with baseline/candidate harness diff.",
    );
  }

  const diffs = harnessAbDiffFields(options.baseline, options.candidate);
  if (diffs.length === 0) {
    throw new EvalInterventionError(
      "No baseline/candidate harness difference (model, judgeModel, or featureToggles). " +
        "Use --harness-config= or feature-surface defaults (e.g. deep_protocol).",
    );
  }

  return { mode: "toggle", headSha };
}

export function validateEvalIntervention(
  baseline: MoonTideEvalHarnessConfig,
  candidate: MoonTideEvalHarnessConfig,
  options: {
    mode?: EvalInterventionMode;
    headSha?: string;
  } = {},
): ResolvedEvalIntervention {
  return resolveEvalIntervention({
    ...options,
    baseline,
    candidate,
  });
}
