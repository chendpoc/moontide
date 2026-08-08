import { DEEPSEEK_ANTHROPIC_BASE_URL, PROVIDER_ENV } from "@moontide/shared/constants/index.js";

export type AdapterFamily = "anthropic-messages";

export interface ProviderPreset {
  id: string;
  displayName: string;
  adapter: AdapterFamily;
  baseUrl: string;
  apiKeyEnv: string;
  official: boolean;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    adapter: "anthropic-messages",
    baseUrl: DEEPSEEK_ANTHROPIC_BASE_URL,
    apiKeyEnv: PROVIDER_ENV.DEEPSEEK_API_KEY,
    official: true,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    adapter: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: PROVIDER_ENV.ANTHROPIC_API_KEY,
    official: true,
  },
};

export function getProviderPreset(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS[presetId];
}
