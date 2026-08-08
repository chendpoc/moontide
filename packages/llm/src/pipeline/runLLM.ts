import { infraError } from "@moontide/shared/errors/factories.js";
import { toFailureOutcome } from "@moontide/shared/errors/outcome.js";

import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import { getLLMProvider } from "../provider.js";
import { resolveRoute } from "../routing/resolve.js";
import type { LLMCallOutcome, LLMCallRecord } from "./types.js";

export interface RunLLMInput extends LLMRequest {
  turn: number;
  deepMode?: boolean;
  onLLMCall?: (record: LLMCallRecord) => void | Promise<void>;
}

export async function runLLM(input: RunLLMInput): Promise<LLMResponse> {
  const { turn, deepMode, onLLMCall, ...request } = input;
  const route = resolveRoute(request.model, { deepMode });

  let outcome: LLMCallOutcome;
  try {
    const response = await getLLMProvider(route).chat({
      ...request,
      model: route.vendorModelId,
      thinkingLevel: route.thinkingLevel,
    });
    outcome = { status: "succeeded", response };
  } catch (err) {
    outcome = toFailureOutcome(err);
  }

  const record: LLMCallRecord = {
    turn,
    request,
    outcome,
    routing: route,
  };
  await onLLMCall?.(record);

  if (outcome.status === "failed") {
    throw infraError(outcome.error);
  }
  return outcome.response;
}
