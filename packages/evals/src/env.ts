import { PROVIDER_PRESETS } from "@moontide/llm";

/** True when at least one configured provider preset has an API key. */
export function hasEvalApiKey(): boolean {
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    if (process.env[preset.apiKeyEnv]?.trim()) {
      return true;
    }
  }
  return false;
}
