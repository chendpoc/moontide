import { extractText } from "@moontide/llm";
import { getLLMProvider } from "@moontide/llm";
import { resolveRoute } from "@moontide/llm";
import type { TextCompletionPort } from "@moontide/context-composer/ports";
import { modelId } from "../config.js";

/** Harness TextCompletionPort — binds provider chat for composer compaction ports. */
export function createTextCompletionPort(logicalModelId = modelId()): TextCompletionPort {
  return {
    async complete(input) {
      const route = resolveRoute(logicalModelId);
      const response = await getLLMProvider(route).chat({
        model: route.vendorModelId,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
        tools: [],
        maxTokens: input.maxTokens ?? 2000,
      });
      return extractText(response.content);
    },
  };
}
