import type { LLMRequest, LLMResponse } from "./protocol/types.js";
import type { ResolvedRoute } from "./routing/types.js";
import { adapterChat, adapterCountTokens } from "./adapters/index.js";

/** Execution control for an LLM call (not model input). */
export interface LLMCallOptions {
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse>;
  countTokens?(request: LLMRequest, options?: LLMCallOptions): Promise<number>;
}

let providerOverride: LLMProvider | undefined;

export function getLLMProvider(route: ResolvedRoute): LLMProvider {
  if (providerOverride) {
    return providerOverride;
  }
  return {
    chat: (request, options) => adapterChat(request, route, options),
    countTokens: (request, options) => adapterCountTokens(request, route, options),
  };
}

/** Test hook — reset with `undefined` to restore default. */
export function setLLMProvider(provider: LLMProvider | undefined): void {
  providerOverride = provider;
}
