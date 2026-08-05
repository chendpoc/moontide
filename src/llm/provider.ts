import type { LLMRequest, LLMResponse } from "./protocol/types.js";
import type { ResolvedRoute } from "./routing/types.js";
import {
  anthropicMessagesChat,
  anthropicMessagesCountTokens,
} from "./adapters/anthropic-messages.js";

export interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResponse>;
  countTokens?(request: LLMRequest): Promise<number>;
}

let providerOverride: LLMProvider | undefined;

export function getLLMProvider(route: ResolvedRoute): LLMProvider {
  if (providerOverride) {
    return providerOverride;
  }
  return {
    chat: (request) => anthropicMessagesChat(request, route),
    countTokens: (request) => anthropicMessagesCountTokens(request, route),
  };
}

/** Test hook — reset with `undefined` to restore default. */
export function setLLMProvider(provider: LLMProvider | undefined): void {
  providerOverride = provider;
}
