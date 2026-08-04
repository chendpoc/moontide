import type {
  ContentBlock,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

import { DEFAULT_MAX_TOKENS } from "../../constants/llm.js";
import { modelId } from "../../config.js";
import {
  anthropicMessagesCountTokens,
  anthropicMessagesRawChat,
  getClient,
} from "../adapters/anthropic-messages.js";
import { extractText } from "../normalize/extract-text.js";
import type { LLMRequest } from "../protocol/types.js";

export { extractText, getClient };

export async function chat(
  messages: MessageParam[],
  tools: Tool[],
  system: string,
  maxTokens = DEFAULT_MAX_TOKENS,
) {
  return anthropicMessagesRawChat(messages, tools, system, maxTokens);
}

export async function countTokens(
  messages: MessageParam[],
  tools: Tool[],
  system: string,
): Promise<number> {
  const request: LLMRequest = {
    model: modelId(),
    system,
    messages: messages as LLMRequest["messages"],
    tools: tools as LLMRequest["tools"],
    maxTokens: DEFAULT_MAX_TOKENS,
  };
  return anthropicMessagesCountTokens(request);
}

export type { ContentBlock, MessageParam, Tool };
