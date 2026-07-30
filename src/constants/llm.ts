/** DeepSeek Anthropic-compatible API base URL. */
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

export const DEFAULT_MODEL = "deepseek-v4-pro";

export const DEFAULT_MAX_TOKENS = 8000;
export const PING_MAX_TOKENS = 512;

export const CONTEXT_LIMITS: Record<string, number> = {
  "deepseek-v4-pro": 128_000,
  "deepseek-v4-flash": 128_000,
  default: 128_000,
};
