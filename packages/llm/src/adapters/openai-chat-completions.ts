import { configError, infraError } from "@moontide/shared/errors/factories.js";

import { fromOpenAiAssistantMessage } from "../normalize/from-openai-assistant.js";
import { mapOpenAiFinishReason } from "../normalize/finish-reason.js";
import { buildOpenAiChatRequestBody } from "../normalize/to-openai-chat-messages.js";
import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import type { LLMCallOptions } from "../provider.js";
import { getProviderPreset } from "../presets/presets.js";
import type { ResolvedRoute } from "../routing/types.js";

function _openAiChatBaseUrl(route: ResolvedRoute): string {
  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }
  return preset.baseUrl;
}

/** OpenAI Chat Completions adapter (tools, thinking, json_object). */
export async function openAiChatCompletions(
  request: LLMRequest,
  route: ResolvedRoute,
  options?: LLMCallOptions,
): Promise<LLMResponse> {
  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }

  const apiKey = process.env[preset.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw configError(`Set ${preset.apiKeyEnv} for preset ${route.providerPresetId}`);
  }

  const body = buildOpenAiChatRequestBody(request);

  const response = await fetch(`${_openAiChatBaseUrl(route)}/chat/completions`, {
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
    throw configError(`OpenAI chat/completions failed (${response.status}): ${detail}`);
  }

  const parsed = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{
          id: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = parsed.choices?.[0];
  if (!choice) {
    throw infraError("LLM response missing choices", {
      context: { reason: "llm_malformed_response" },
    });
  }

  const content = fromOpenAiAssistantMessage(choice.message);
  const stopReason = mapOpenAiFinishReason(choice.finish_reason);
  if (
    content.length === 0
    && stopReason !== "max_tokens"
    && stopReason !== "tool_use"
  ) {
    throw infraError("LLM response empty assistant message", {
      context: { reason: "llm_malformed_response" },
    });
  }

  return {
    content,
    stopReason,
    usage:
      parsed.usage?.prompt_tokens !== undefined
        ? {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          }
        : undefined,
    model: parsed.model ?? request.model,
  };
}
