import { compactAutoDefault, compactKeepTurns, compactThreshold, contextLimit, modelId } from "../../config.js";
import { defaultCompactionPolicy } from "../../context/composer/compaction/policy.js";
import type { CompactionPolicy } from "../../context/composer/compaction/policy.js";
import type { ModelProfile } from "./types.js";

export function resolveModelProfile(logicalModelId = modelId()): ModelProfile {
  return {
    logicalModelId,
    contextWindow: contextLimit(),
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsThinking: false,
    tokenCount: "estimate",
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
