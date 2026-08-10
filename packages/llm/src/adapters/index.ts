import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import type { ResolvedRoute } from "../routing/types.js";
import { anthropicMessagesChat, anthropicMessagesCountTokens } from "./anthropic-messages.js";
import { openAiChatCompletions } from "./openai-chat-completions.js";

export function adapterChat(request: LLMRequest, route: ResolvedRoute): Promise<LLMResponse> {
  switch (route.adapterFamily) {
    case "openai-chat-completions":
      return openAiChatCompletions(request, route);
    case "anthropic-messages":
      return anthropicMessagesChat(request, route);
    default:
      throw new Error(`Unsupported adapterFamily: ${route.adapterFamily}`);
  }
}

export function adapterCountTokens(request: LLMRequest, route: ResolvedRoute): Promise<number> {
  if (route.adapterFamily === "anthropic-messages") {
    return anthropicMessagesCountTokens(request, route);
  }
  return Promise.resolve(0);
}
