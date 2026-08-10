import { DEEPSEEK_ANTHROPIC_BASE_URL } from "@moontide/shared/constants/llm.js";
import { configError, infraError } from "@moontide/shared/errors/factories.js";

import { toAnthropicCountTokensBody } from "../normalize/to-anthropic-count-tokens-body.js";
import type { LLMRequest } from "../protocol/types.js";
import type { LLMCallOptions } from "../provider.js";
import { getProviderPreset } from "../presets/presets.js";
import type { ResolvedRoute } from "../routing/types.js";
import { resolveCountTokensSupport } from "./count-tokens-support.js";

/** DeepSeek count_tokens via Anthropic-compatible endpoint (fetch). */
export async function deepseekCountTokens(
  request: LLMRequest,
  route: ResolvedRoute,
  options?: LLMCallOptions,
): Promise<number> {
  const support = await resolveCountTokensSupport(route);
  if (support !== "supported") {
    throw infraError("DeepSeek count_tokens unavailable", {
      context: { reason: "count_tokens_unsupported" },
    });
  }

  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }

  const apiKey = process.env[preset.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw configError(`Set ${preset.apiKeyEnv} for preset ${route.providerPresetId}`);
  }

  const body = toAnthropicCountTokensBody({
    ...request,
    model: route.vendorModelId,
  });

  const response = await fetch(`${DEEPSEEK_ANTHROPIC_BASE_URL}/v1/messages/count_tokens`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw infraError(`DeepSeek count_tokens failed (${response.status}): ${detail}`, {
      context: { reason: "count_tokens_unsupported" },
    });
  }

  const parsed = (await response.json()) as { input_tokens?: number };
  if (typeof parsed.input_tokens !== "number") {
    throw infraError("DeepSeek count_tokens response missing input_tokens", {
      context: { reason: "llm_malformed_response" },
    });
  }
  return parsed.input_tokens;
}
