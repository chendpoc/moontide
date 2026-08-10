import { infraError } from "@moontide/shared/errors/factories.js";
import { toFailureOutcome } from "@moontide/shared/errors/outcome.js";

import type { LLMCallOptions } from "../provider.js";
import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import { getLLMProvider } from "../provider.js";
import { resolveRoute } from "../routing/resolve.js";
import type { LLMCallOutcome, LLMCallRecord } from "./types.js";
import { isAbortError } from "./abort.js";

export interface RunLLMInput extends LLMRequest {
  turn: number;
  deepMode?: boolean;
  signal?: AbortSignal;
  onLLMCall?: (record: LLMCallRecord) => void | Promise<void>;
}

export async function runLLM(input: RunLLMInput): Promise<LLMResponse> {
  const { turn, deepMode, signal, onLLMCall, ...request } = input;
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const route = resolveRoute(request.model, {
    deepMode,
    jsonObject: request.responseFormat === "json_object",
  });
  const resolvedRequest: LLMRequest = {
    ...request,
    model: route.vendorModelId,
    thinkingLevel: route.thinkingLevel,
  };
  const callOptions: LLMCallOptions = { signal };

  let outcome: LLMCallOutcome;
  try {
    const response = await getLLMProvider(route).chat(resolvedRequest, callOptions);
    outcome = { status: "succeeded", response };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      throw err;
    }
    outcome = toFailureOutcome(err);
  }

  const record: LLMCallRecord = {
    turn,
    request: resolvedRequest,
    outcome,
    routing: route,
  };
  await onLLMCall?.(record);

  if (outcome.status === "failed") {
    throw infraError(outcome.error);
  }
  return outcome.response;
}
