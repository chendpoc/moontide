import type { ModelRegistryEntry } from "./registry-types.js";

export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Static logical model registry (cloud models). */
export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  "deepseek-v4-pro": {
    displayName: "DeepSeek V4 Pro",
    contextWindow: 128_000,
    supportsTools: true,
    supportsThinking: false,
    maxOutputTokens: 8192,
    defaultThinking: "medium",
    routes: {
      deepseek: { modelId: "deepseek-v4-pro" },
      anthropic: { modelId: "deepseek-v4-pro" },
    },
    prefer: ["deepseek", "anthropic"],
  },
  "deepseek-v4-flash": {
    displayName: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsThinking: false,
    maxOutputTokens: 8192,
    defaultThinking: "off",
    routes: {
      deepseek: { modelId: "deepseek-v4-flash" },
      anthropic: { modelId: "deepseek-v4-flash" },
    },
    prefer: ["deepseek", "anthropic"],
  },
};

export function lookupModelEntry(logicalModelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY[logicalModelId];
}
