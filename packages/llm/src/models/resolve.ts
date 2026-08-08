import {
  compactAutoDefault,
  compactKeepTurns,
  compactThreshold,
  contextExact,
  contextLimitOverride,
  modelId,
} from "../env-config.js";
import { DEFAULT_CONTEXT_WINDOW, lookupModelEntry } from "./registry.js";
import type { ModelProfile } from "./types.js";
import { defaultCompactionPolicy, type CompactionPolicy } from "./compaction-policy.js";

export function resolveModelProfile(logicalModelId = modelId()): ModelProfile {
  const entry = lookupModelEntry(logicalModelId);
  return {
    logicalModelId,
    contextWindow: contextLimitOverride() ?? entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: entry?.maxOutputTokens ?? 8192,
    supportsTools: entry?.supportsTools ?? true,
    supportsThinking: entry?.supportsThinking ?? false,
    tokenCount: contextExact() ? "api" : "estimate",
  };
}

export function resolveCompactionPolicy(): CompactionPolicy {
  return {
    ...defaultCompactionPolicy,
    autoEnabled: compactAutoDefault(),
    thresholdPercent: compactThreshold(),
    keepTurns: compactKeepTurns(),
  };
}
