import { DEEPSEEK_ANTHROPIC_BASE_URL } from "@moontide/shared/constants/llm.js";
import { PROVIDER_ENV } from "@moontide/shared/constants/index.js";

import type { ResolvedRoute } from "../routing/types.js";

export type CountTokensSupport = "supported" | "unsupported";

let _cachedSupport: CountTokensSupport | undefined;

const _PROBE_URL = `${DEEPSEEK_ANTHROPIC_BASE_URL}/v1/messages/count_tokens`;

/** Reset cached preflight (tests). */
export function resetCountTokensSupportCache(): void {
  _cachedSupport = undefined;
}

export function getCountTokensSupportCache(): CountTokensSupport | undefined {
  return _cachedSupport;
}

async function _probeDeepSeekCountTokens(apiKey: string): Promise<boolean> {
  const response = await fetch(_PROBE_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!response.ok) {
    return false;
  }
  const parsed = (await response.json()) as { input_tokens?: number };
  return typeof parsed.input_tokens === "number" && parsed.input_tokens >= 0;
}

/** Live preflight (gated on DEEPSEEK_API_KEY); caches supported / unsupported. */
export async function resolveCountTokensSupport(
  route: ResolvedRoute,
): Promise<CountTokensSupport> {
  if (_cachedSupport) {
    return _cachedSupport;
  }
  if (route.providerPresetId !== "deepseek") {
    _cachedSupport = "unsupported";
    return _cachedSupport;
  }

  const apiKey = process.env[PROVIDER_ENV.DEEPSEEK_API_KEY]?.trim();
  if (!apiKey) {
    _cachedSupport = "unsupported";
    return _cachedSupport;
  }

  const ok = await _probeDeepSeekCountTokens(apiKey);
  _cachedSupport = ok ? "supported" : "unsupported";
  return _cachedSupport;
}
