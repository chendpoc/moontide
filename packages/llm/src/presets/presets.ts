import { DEEPSEEK_OPENAI_BASE_URL, PROVIDER_ENV } from "@moontide/shared/constants/index.js";

export type AdapterFamily = "openai-chat-completions" | "openai-responses";

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
    adapter: "openai-chat-completions",
    baseUrl: DEEPSEEK_OPENAI_BASE_URL,
    apiKeyEnv: PROVIDER_ENV.DEEPSEEK_API_KEY,
    official: true,
  },
};

export function getProviderPreset(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS[presetId];
}
