import { ENV_PREFIX } from "../../../constants/env.js";

import type { WorkMemBudgetTier, WorkMemPackTier } from "./types.js";

export const WORK_MEM_CAP_NORMAL = 8000;
export const WORK_MEM_CAP_UPGRADE_PCT = 0.10;

const DEFAULT_SUMMARIZE_CHARS = 14_000;
const DEFAULT_REFINE_CHARS = 8000;
const DEFAULT_EMERGENCY_CHARS = 4000;

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}${name}`];
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function workMemSummarizeChars(): number {
  return envPositiveInt("WORK_MEM_SUMMARIZE_CHARS", DEFAULT_SUMMARIZE_CHARS);
}

export function workMemRefineChars(): number {
  return envPositiveInt("WORK_MEM_REFINE_CHARS", DEFAULT_REFINE_CHARS);
}

export function workMemEmergencyChars(): number {
  return envPositiveInt("WORK_MEM_EMERGENCY_CHARS", DEFAULT_EMERGENCY_CHARS);
}

export function workMemNoteTailForTier(tier: WorkMemPackTier): number {
  if (tier === "compact") {
    return 2;
  }
  if (tier === "emergency") {
    return 1;
  }
  return envPositiveInt("WORK_MEM_NOTE_TAIL", 5);
}

export function maxCharsForPackTier(tier: WorkMemPackTier, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  if (tier === "compact") {
    return workMemRefineChars();
  }
  if (tier === "emergency") {
    return workMemEmergencyChars();
  }
  return workMemSummarizeChars();
}

/** @precondition Deep Task Mode active */
export function resolveWorkMemTokenCap(opts: {
  contextWindow: number;
  tier: WorkMemBudgetTier;
}): number {
  if (opts.tier === "normal") {
    return WORK_MEM_CAP_NORMAL;
  }
  return Math.floor(opts.contextWindow * WORK_MEM_CAP_UPGRADE_PCT);
}
