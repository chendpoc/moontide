import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import type { LLMCallOptions } from "../provider.js";
import type { ResolvedRoute } from "../routing/types.js";
import { openAiChatCompletions } from "./openai-chat-completions.js";

export function adapterChat(
  request: LLMRequest,
  route: ResolvedRoute,
  options?: LLMCallOptions,
): Promise<LLMResponse> {
  switch (route.adapterFamily) {
    case "openai-chat-completions":
      return openAiChatCompletions(request, route, options);
    case "openai-responses":
      throw new Error("openai-responses adapter not implemented");
    default: {
      const _exhaustive: never = route.adapterFamily;
      throw new Error(`Unsupported adapterFamily: ${String(_exhaustive)}`);
    }
  }
}

export function adapterCountTokens(
  _request: LLMRequest,
  _route: ResolvedRoute,
  _options?: LLMCallOptions,
): Promise<number> {
  return Promise.resolve(0);
}
