import { APP_ENV, envVarName } from "@moontide/shared";

import type { ModelRegistryEntry } from "../models/registry-types.js";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

const THINKING_RANK: Record<ThinkingLevel, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function maxThinkingLevel(a: ThinkingLevel, b: ThinkingLevel): ThinkingLevel {
  return THINKING_RANK[a] >= THINKING_RANK[b] ? a : b;
}

/** Explicit user override via APP_ENV.THINKING_LEVEL (off|low|medium|high). */
export function explicitThinkingLevelFromEnv(): ThinkingLevel | undefined {
  const raw = process.env[envVarName(APP_ENV.THINKING_LEVEL)]?.trim().toLowerCase();
  if (raw === "off" || raw === "low" || raw === "medium" || raw === "high") {
    return raw;
  }
  return undefined;
}

export interface ResolveThinkingLevelInput {
  entry?: Pick<ModelRegistryEntry, "supportsThinking" | "defaultThinking">;
  deepMode?: boolean;
}

/** Resolve reasoning depth for a route; deep mode bumps to at least high when supported. */
export function resolveThinkingLevel(input: ResolveThinkingLevelInput): ThinkingLevel {
  const explicit = explicitThinkingLevelFromEnv();
  if (explicit) {
    return explicit;
  }

  const base: ThinkingLevel = input.entry?.defaultThinking ?? "off";
  if (input.deepMode && input.entry?.supportsThinking) {
    return maxThinkingLevel(base, "high");
  }
  return base;
}

/** True when deep mode raised thinking above registry default (not env-overridden). */
export function isDeepThinkingBump(input: ResolveThinkingLevelInput): boolean {
  if (explicitThinkingLevelFromEnv()) {
    return false;
  }
  if (!input.deepMode || !input.entry?.supportsThinking) {
    return false;
  }
  const base: ThinkingLevel = input.entry.defaultThinking ?? "off";
  return THINKING_RANK[resolveThinkingLevel(input)] > THINKING_RANK[base];
}
