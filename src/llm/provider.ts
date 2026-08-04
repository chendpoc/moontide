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

const defaultProvider: LLMProvider = {
  chat: anthropicMessagesChat,
  countTokens: anthropicMessagesCountTokens,
};

let providerOverride: LLMProvider | undefined;

export function getLLMProvider(_route?: ResolvedRoute): LLMProvider {
  return providerOverride ?? defaultProvider;
}

/** Test hook — reset with `undefined` to restore default. */
export function setLLMProvider(provider: LLMProvider | undefined): void {
  providerOverride = provider;
}
