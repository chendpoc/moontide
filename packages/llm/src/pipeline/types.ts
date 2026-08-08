import type { LLMRequest, LLMResponse } from "../protocol/types.js";
import type { ResolvedRoute } from "../routing/types.js";

export type LLMCallOutcome =
  | { status: "succeeded"; response: LLMResponse }
  | { status: "failed"; error: string };

export interface LLMCallRecord {
  turn: number;
  request: LLMRequest;
  outcome: LLMCallOutcome;
  routing?: ResolvedRoute;
}
