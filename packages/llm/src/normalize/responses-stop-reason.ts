import { infraError } from "@moontide/shared/errors/factories.js";

import type { LLMStopReason } from "../protocol/types.js";

export interface ResponsesIncompleteDetails {
  reason?: string | null;
}

/** Derive MoonTide stop reason from Responses API status and output. */
export function mapResponsesStopReason(
  status: string | null | undefined,
  incompleteDetails: ResponsesIncompleteDetails | null | undefined,
  hasFunctionCall: boolean,
): LLMStopReason {
  if (status === "failed") {
    return "provider_error";
  }

  if (status === "incomplete") {
    const reason = incompleteDetails?.reason;
    if (reason === "max_output_tokens") {
      return "max_tokens";
    }
    if (reason === "content_filter") {
      return "content_filter";
    }
    throw infraError(`Unknown Responses incomplete reason: ${String(reason)}`, {
      context: { reason: "llm_malformed_response", incompleteReason: reason },
    });
  }

  if (status === "completed") {
    return hasFunctionCall ? "tool_use" : "end_turn";
  }

  throw infraError(`Unknown Responses status: ${String(status)}`, {
    context: { reason: "llm_malformed_response", responseStatus: status },
  });
}
