import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { configError } from "@moontide/shared/errors/factories.js";

import type { ContentBlock, LLMRequest, LLMResponse } from "../protocol/types.js";
import { getProviderPreset } from "../presets/presets.js";
import type { ResolvedRoute } from "../routing/types.js";

const clients = new Map<string, Anthropic>();

export function getClientForPreset(presetId: string): Anthropic {
  const preset = getProviderPreset(presetId);
  if (!preset) {
    throw configError(`Unknown provider preset: ${presetId}`);
  }

  const cached = clients.get(presetId);
  if (cached) {
    return cached;
  }

  const apiKey = process.env[preset.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw configError(`Set ${preset.apiKeyEnv} for preset ${presetId}`);
  }

  const client = new Anthropic({ apiKey, baseURL: preset.baseUrl });
  clients.set(presetId, client);
  return client;
}

/** Test hook — clear cached SDK clients between tests. */
export function resetAnthropicClients(): void {
  clients.clear();
}

function toSdkMessages(messages: LLMRequest["messages"]): MessageParam[] {
  return messages as MessageParam[];
}

function toSdkTools(tools: LLMRequest["tools"]): Tool[] {
  return tools as Tool[];
}

function fromSdkResponse(message: Anthropic.Message): LLMResponse {
  return {
    content: message.content as ContentBlock[],
    stopReason: message.stop_reason ?? "end_turn",
    usage: message.usage
      ? {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        }
      : undefined,
    model: message.model,
  };
}

export async function anthropicMessagesChat(
  request: LLMRequest,
  route: ResolvedRoute,
): Promise<LLMResponse> {
  const response = await getClientForPreset(route.providerPresetId).messages.create({
    model: request.model,
    system: request.system,
    messages: toSdkMessages(request.messages),
    tools: toSdkTools(request.tools),
    max_tokens: request.maxTokens,
  });
  return fromSdkResponse(response);
}

export async function anthropicMessagesCountTokens(
  request: LLMRequest,
  route: ResolvedRoute,
): Promise<number> {
  const result = await getClientForPreset(route.providerPresetId).messages.countTokens({
    model: request.model,
    system: request.system,
    messages: toSdkMessages(request.messages),
    tools: toSdkTools(request.tools),
  });
  return result.input_tokens;
}
