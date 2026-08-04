import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock as SdkContentBlock,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

import { apiKey, baseUrl, modelId } from "../../config.js";
import type { ContentBlock, LLMRequest, LLMResponse } from "../protocol/types.js";

let client: Anthropic | undefined;

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: apiKey(), baseURL: baseUrl() });
  }
  return client;
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

export async function anthropicMessagesChat(request: LLMRequest): Promise<LLMResponse> {
  const response = await getClient().messages.create({
    model: request.model,
    system: request.system,
    messages: toSdkMessages(request.messages),
    tools: toSdkTools(request.tools),
    max_tokens: request.maxTokens,
  });
  return fromSdkResponse(response);
}

export async function anthropicMessagesCountTokens(request: LLMRequest): Promise<number> {
  const result = await getClient().messages.countTokens({
    model: request.model,
    system: request.system,
    messages: toSdkMessages(request.messages),
    tools: toSdkTools(request.tools),
  });
  return result.input_tokens;
}

/** Legacy SDK chat for healthcheck and transitional callers. */
export async function anthropicMessagesRawChat(
  messages: MessageParam[],
  tools: Tool[],
  system: string,
  maxTokens: number,
): Promise<{ content: SdkContentBlock[]; stop_reason: string | null; usage?: Anthropic.Message["usage"] }> {
  return getClient().messages.create({
    model: modelId(),
    system,
    messages,
    tools,
    max_tokens: maxTokens,
  });
}
