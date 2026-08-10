import { normalizeHarnessConfig } from "./harness-env.js";
import type { MoonTideEvalHarnessConfig } from "./types.js";

export interface ComparabilityResult {
  comparable: boolean;
  reason?: string;
}

/** True when baseline/candidate arms use the same agent model and thinking pin. */
export function checkArmsComparable(
  baseline: MoonTideEvalHarnessConfig,
  candidate: MoonTideEvalHarnessConfig,
): ComparabilityResult {
  const base = normalizeHarnessConfig(baseline);
  const cand = normalizeHarnessConfig(candidate);

  if (base.model !== cand.model) {
    return {
      comparable: false,
      reason: `agent model mismatch: baseline=${base.model} candidate=${cand.model}`,
    };
  }

  if (base.judgeModel !== cand.judgeModel) {
    return {
      comparable: false,
      reason: `judge model mismatch: baseline=${base.judgeModel} candidate=${cand.judgeModel}`,
    };
  }

  return { comparable: true };
}
