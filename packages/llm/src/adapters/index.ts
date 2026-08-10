import { configError, infraError } from "@moontide/shared/errors/factories.js";

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
      return Promise.reject(
        configError("openai-responses adapter not implemented", {
          context: {
            reason: "adapter_not_implemented",
            adapterFamily: route.adapterFamily,
          },
        }),
      );
    default: {
      const _exhaustive: never = route.adapterFamily;
      throw configError(`Unsupported adapterFamily: ${String(_exhaustive)}`, {
        context: {
          reason: "adapter_not_supported",
          adapterFamily: route.adapterFamily,
        },
      });
    }
  }
}

export async function adapterCountTokens(
  _request: LLMRequest,
  route: ResolvedRoute,
  _options?: LLMCallOptions,
): Promise<number> {
  if (route.providerPresetId === "deepseek") {
    throw infraError("DeepSeek count_tokens unavailable", {
      context: { reason: "count_tokens_unsupported" },
    });
  }
  throw infraError("count_tokens unsupported for provider preset", {
    context: {
      reason: "count_tokens_unsupported",
      providerPresetId: route.providerPresetId,
      adapterFamily: route.adapterFamily,
    },
  });
}
