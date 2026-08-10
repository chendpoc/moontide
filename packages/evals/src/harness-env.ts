import { APP_ENV, envVarName, PROVIDER_ENV } from "@moontide/shared";

import type { MoonTideEvalHarnessConfig } from "./types.js";

export const DEFAULT_EVAL_AGENT_MODEL = "deepseek-v4-flash";
export const DEFAULT_EVAL_JUDGE_MODEL = "deepseek-v4-flash";
export const DEFAULT_EVAL_THINKING_LEVEL = "off" as const;

export function normalizeHarnessConfig(
  harness: MoonTideEvalHarnessConfig,
): MoonTideEvalHarnessConfig {
  return {
    ...harness,
    model: harness.model ?? DEFAULT_EVAL_AGENT_MODEL,
    judgeModel: harness.judgeModel ?? DEFAULT_EVAL_JUDGE_MODEL,
  };
}

/** Apply harness model + eval thinking pin; restore previous env on teardown. */
export function applyHarnessRuntimeEnv(harness: MoonTideEvalHarnessConfig): () => void {
  const normalized = normalizeHarnessConfig(harness);
  const prev: Record<string, string | undefined> = {
    [PROVIDER_ENV.MODEL_ID]: process.env[PROVIDER_ENV.MODEL_ID],
    [envVarName(APP_ENV.THINKING_LEVEL)]: process.env[envVarName(APP_ENV.THINKING_LEVEL)],
  };

  process.env[PROVIDER_ENV.MODEL_ID] = normalized.model!;
  process.env[envVarName(APP_ENV.THINKING_LEVEL)] = DEFAULT_EVAL_THINKING_LEVEL;

  return () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
