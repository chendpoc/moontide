import type { ModelRegistryEntry } from "./registry-types.js";

export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Static logical model registry (cloud models). */
export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  "deepseek-v4-pro": {
    displayName: "DeepSeek V4 Pro",
    contextWindow: 128_000,
    supportsTools: true,
    supportsThinking: true,
    maxOutputTokens: 8192,
    defaultThinking: "medium",
    routes: {
      deepseek: {
        modelId: "deepseek-v4-pro",
        adapterFamilies: ["openai-chat-completions"],
        thinkingLevels: {
          off: "supported",
          low: "supported",
          medium: "emulated",
          high: "supported",
        },
      },
    },
    prefer: ["deepseek"],
  },
  "deepseek-v4-flash": {
    displayName: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsThinking: true,
    maxOutputTokens: 8192,
    defaultThinking: "off",
    routes: {
      deepseek: {
        modelId: "deepseek-v4-flash",
        adapterFamilies: ["openai-chat-completions", "openai-responses"],
        thinkingLevels: {
          off: "supported",
          low: "supported",
          medium: "emulated",
          high: "supported",
        },
      },
    },
    prefer: ["deepseek"],
  },
};

export function lookupModelEntry(logicalModelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY[logicalModelId];
}
