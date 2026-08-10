import { configError } from "@moontide/shared/errors/factories.js";

import type { ContentBlock, LLMRequest, LLMResponse, Message } from "../protocol/types.js";
import { getProviderPreset } from "../presets/presets.js";
import type { ResolvedRoute } from "../routing/types.js";

function _messageText(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function _toOpenAiMessages(
  request: LLMRequest,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  if (request.system.trim().length > 0) {
    messages.push({ role: "system", content: request.system });
  }
  for (const message of request.messages) {
    if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: _messageText(message.content) });
    }
  }
  return messages;
}

function _openAiChatBaseUrl(route: ResolvedRoute): string {
  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }
  if (preset.openAiChatBaseUrl) {
    return preset.openAiChatBaseUrl;
  }
  return preset.baseUrl;
}

/** OpenAI Chat Completions adapter (json_object judge path; no tool loop). */
export async function openAiChatCompletions(
  request: LLMRequest,
  route: ResolvedRoute,
): Promise<LLMResponse> {
  const preset = getProviderPreset(route.providerPresetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${route.providerPresetId}`);
  }

  const apiKey = process.env[preset.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw configError(`Set ${preset.apiKeyEnv} for preset ${route.providerPresetId}`);
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: _toOpenAiMessages(request),
    max_tokens: request.maxTokens,
  };
  if (request.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${_openAiChatBaseUrl(route)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw configError(`OpenAI chat/completions failed (${response.status}): ${detail}`);
  }

  const parsed = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = parsed.choices?.[0];
  const text = choice?.message?.content ?? "";
  return {
    content: text.length > 0 ? [{ type: "text", text }] : [],
    stopReason: choice?.finish_reason ?? "end_turn",
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
