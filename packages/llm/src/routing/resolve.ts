import { configError } from "@moontide/shared/errors/factories.js";

import { modelId, providerPresetId } from "../env-config.js";
import { lookupModelEntry } from "../models/registry.js";
import { getProviderPreset, PROVIDER_PRESETS } from "../presets/presets.js";
import { resolveThinkingLevel } from "./thinking.js";
import type { ResolvedRoute } from "./types.js";

const DEFAULT_PRESET_PREFER = ["deepseek", "anthropic"] as const;

function presetHasApiKey(presetId: string): boolean {
  const preset = getProviderPreset(presetId);
  if (!preset) {
    return false;
  }
  const key = process.env[preset.apiKeyEnv]?.trim();
  return Boolean(key);
}

function resolvePresetId(logicalModelId: string): string {
  const explicit = providerPresetId();
  const entry = lookupModelEntry(logicalModelId);

  if (explicit) {
    if (!getProviderPreset(explicit)) {
      throw configError(`Unknown provider preset: ${explicit}`);
    }
    if (entry && !entry.routes[explicit]) {
      throw configError(`Model ${logicalModelId} has no route for preset ${explicit}`);
    }
    if (!presetHasApiKey(explicit)) {
      const preset = getProviderPreset(explicit)!;
      throw configError(`Set ${preset.apiKeyEnv} for provider preset ${explicit}`);
    }
    return explicit;
  }

  const prefer = entry?.prefer ?? [...DEFAULT_PRESET_PREFER];
  for (const presetId of prefer) {
    if (presetHasApiKey(presetId)) {
      return presetId;
    }
  }

  throw configError("Set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY in .env");
}

/** Resolve logical model + env keys to a provider route. */
export function resolveRoute(
  logicalModelId = modelId(),
  options?: { deepMode?: boolean; jsonObject?: boolean },
): ResolvedRoute {
  const presetId = resolvePresetId(logicalModelId);
  const preset = PROVIDER_PRESETS[presetId]!;
  const entry = lookupModelEntry(logicalModelId);
  const vendorModelId = entry?.routes[presetId]?.modelId ?? logicalModelId;
  const thinkingLevel = resolveThinkingLevel({ entry, deepMode: options?.deepMode });

  let adapterFamily = preset.adapter;
  if (options?.jsonObject && preset.openAiChatBaseUrl) {
    adapterFamily = "openai-chat-completions";
  }

  return {
    logicalModelId,
    providerPresetId: presetId,
    vendorModelId,
    adapterFamily,
    thinkingLevel,
  };
}

export function toRoutingDecision(route: ResolvedRoute, mode: "manual" | "auto" = "manual") {
  return {
    logicalModelId: route.logicalModelId,
    providerPresetId: route.providerPresetId,
    vendorModelId: route.vendorModelId,
    thinkingLevel: route.thinkingLevel,
    mode,
    reason: mode === "manual" ? "env" : undefined,
  };
}
