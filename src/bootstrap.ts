import { config as loadEnv } from "dotenv";

import { DEEPSEEK_ANTHROPIC_BASE_URL, PROVIDER_ENV } from "./constants/index.js";

loadEnv({ override: true });

/** Map DeepSeek credentials to Anthropic-compatible env for the SDK. */
function bootstrapProviderEnv(): void {
  if (
    process.env[PROVIDER_ENV.DEEPSEEK_API_KEY]
    && !process.env[PROVIDER_ENV.ANTHROPIC_API_KEY]
  ) {
    process.env[PROVIDER_ENV.ANTHROPIC_API_KEY] = process.env[PROVIDER_ENV.DEEPSEEK_API_KEY];
  }

  if (
    process.env[PROVIDER_ENV.DEEPSEEK_API_KEY]
    && !process.env[PROVIDER_ENV.ANTHROPIC_BASE_URL]
  ) {
    process.env[PROVIDER_ENV.ANTHROPIC_BASE_URL] = DEEPSEEK_ANTHROPIC_BASE_URL;
  }

  if (process.env[PROVIDER_ENV.ANTHROPIC_BASE_URL]) {
    delete process.env[PROVIDER_ENV.ANTHROPIC_AUTH_TOKEN];
  }
}

bootstrapProviderEnv();
