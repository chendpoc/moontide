import { configError, infraError } from "@moontide/shared/errors/factories.js";

import {
  fromOpenAiResponsesOutput,
  responsesOutputHasFunctionCall,
} from "../normalize/from-openai-responses.js";
import { mapResponsesStopReason } from "../normalize/responses-stop-reason.js";
import { buildOpenAiResponsesRequestBody } from "../normalize/to-openai-responses-body.js";
import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import type { LLMCallOptions } from "../provider.js";
import { getProviderPreset } from "../presets/presets.js";
import type { ResolvedRoute } from "../routing/types.js";

const RESPONSES_FLASH_MODEL = "deepseek-v4-flash";

function _responsesBaseUrl(route: ResolvedRoute): string {
  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }
  return preset.baseUrl;
}

function _assertResponsesModel(model: string): void {
  if (model !== RESPONSES_FLASH_MODEL) {
    throw configError(`Responses API supports ${RESPONSES_FLASH_MODEL} only`, {
      context: {
        reason: "responses_model_not_supported",
        model,
        supportedModel: RESPONSES_FLASH_MODEL,
      },
    });
  }
}

/** OpenAI Responses API adapter (flash only, stateless multi-turn via input replay). */
export async function openAiResponses(
  request: LLMRequest,
  route: ResolvedRoute,
  options?: LLMCallOptions,
): Promise<LLMResponse> {
  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }

  _assertResponsesModel(request.model);

  const apiKey = process.env[preset.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw configError(`Set ${preset.apiKeyEnv} for preset ${route.providerPresetId}`);
  }

  const body = buildOpenAiResponsesRequestBody(request);

  const response = await fetch(`${_responsesBaseUrl(route)}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw configError(`OpenAI responses failed (${response.status}): ${detail}`);
  }

  const parsed = (await response.json()) as {
    status?: string;
    incomplete_details?: { reason?: string | null };
    model?: string;
    output?: Array<{
      type?: string;
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
      call_id?: string;
      name?: string;
      arguments?: string;
    }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };

  const output = parsed.output;
  const hasFunctionCall = responsesOutputHasFunctionCall(output);
  const content = fromOpenAiResponsesOutput(output);
  const stopReason = mapResponsesStopReason(parsed.status, parsed.incomplete_details, hasFunctionCall);

  if (
    content.length === 0
    && stopReason !== "max_tokens"
    && stopReason !== "tool_use"
  ) {
    throw infraError("LLM response empty output", {
      context: { reason: "llm_malformed_response" },
    });
  }

  return {
    content,
    stopReason,
    usage:
      parsed.usage?.input_tokens !== undefined
        ? {
            inputTokens: parsed.usage.input_tokens ?? 0,
            outputTokens: parsed.usage.output_tokens ?? 0,
          }
        : undefined,
    model: parsed.model ?? request.model,
  };
}
