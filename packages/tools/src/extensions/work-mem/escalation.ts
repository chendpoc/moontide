import { estimateTextTokens } from "@moontide/session/block-registry";

import {
  resolveWorkMemTokenCap,
  WORK_MEM_CAP_NORMAL,
} from "./config.js";
import { readWorkMemEvents } from "./store.js";
import {
  estimatePackTokens,
  latestPackText,
  packWorkMemEvents,
} from "./summarize.js";
import type { WorkMemPackTier } from "./types.js";

import type { WorkMemBudgetTier, WorkMemEscalationStage } from "./types.js";

/** Escalation resolution measures raw pack size; agent-facing summarize/refine still use tier char caps. */
const MEASURE_CHAR_CAP = Number.MAX_SAFE_INTEGER;

const STAGE_ORDER: WorkMemEscalationStage[] = [
  "normal",
  "refined_at_normal",
  "cap_upgraded",
  "emergency",
];

export interface ResolveWorkingSetInput {
  workdir: string;
  sessionId: string;
  workMemId: string;
  contextWindow: number;
  minStage?: WorkMemEscalationStage;
}

export interface ResolvedWorkingSet {
  text: string;
  stage: WorkMemEscalationStage;
  budgetTier: WorkMemBudgetTier;
  truncated: boolean;
}

function stageRank(stage: WorkMemEscalationStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function packAndMeasure(
  events: ReturnType<typeof readWorkMemEvents>,
  tier: WorkMemPackTier,
): { text: string; tokens: number; truncated: boolean } {
  const packed = packWorkMemEvents(events, tier, MEASURE_CHAR_CAP);
  return {
    text: packed.text,
    tokens: estimatePackTokens(packed.text),
    truncated: packed.truncated,
  };
}

function resolveFromCompact(
  events: ReturnType<typeof readWorkMemEvents>,
  contextWindow: number,
): ResolvedWorkingSet {
  const { text, tokens, truncated } = packAndMeasure(events, "compact");
  if (tokens <= WORK_MEM_CAP_NORMAL) {
    return { text, stage: "refined_at_normal", budgetTier: "normal", truncated };
  }

  const upgradedCap = resolveWorkMemTokenCap({
    contextWindow,
    tier: "upgraded",
  });
  if (tokens <= upgradedCap) {
    return { text, stage: "cap_upgraded", budgetTier: "upgraded", truncated };
  }

  const emergency = packWorkMemEvents(events, "emergency");
  return {
    text: emergency.text,
    stage: "emergency",
    budgetTier: "upgraded",
    truncated: emergency.truncated || estimatePackTokens(emergency.text) > upgradedCap,
  };
}

function resolveWorkingSetInternal(
  events: ReturnType<typeof readWorkMemEvents>,
  contextWindow: number,
): ResolvedWorkingSet {
  const latest = latestPackText(events);
  if (latest && events.length > 0) {
    const tokens = estimateTextTokens(latest);
    if (tokens <= WORK_MEM_CAP_NORMAL) {
      return {
        text: latest,
        stage: "normal",
        budgetTier: "normal",
        truncated: false,
      };
    }
  }

  const { text, tokens, truncated } = packAndMeasure(events, "normal");
  if (tokens <= WORK_MEM_CAP_NORMAL) {
    return { text, stage: "normal", budgetTier: "normal", truncated };
  }

  return resolveFromCompact(events, contextWindow);
}

/** Budget escalation — run before compose inject (Phase B). */
export function resolveWorkingSetSnapshot(input: ResolveWorkingSetInput): ResolvedWorkingSet {
  const events = readWorkMemEvents(input.workdir, input.sessionId, input.workMemId);
  const resolved = resolveWorkingSetInternal(events, input.contextWindow);

  if (
    input.minStage !== undefined &&
    stageRank(resolved.stage) < stageRank(input.minStage)
  ) {
    return resolveFromCompact(events, input.contextWindow);
  }

  return resolved;
}
