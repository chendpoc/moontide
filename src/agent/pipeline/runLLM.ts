import { infraError } from "../../errors/factories.js";
import { toFailureOutcome } from "../../errors/outcome.js";
import type { LLMRequest, LLMResponse } from "../../llm/protocol/types.js";
import { getLLMProvider } from "../../llm/provider.js";
import type { AgentRuntime } from "../runtime/index.js";
import type { LLMCallOutcome, LLMCallRecord } from "./types.js";

export interface RunLLMInput extends LLMRequest {
  turn: number;
  runtime: AgentRuntime;
}

export async function runLLM(input: RunLLMInput): Promise<LLMResponse> {
  const { turn, runtime, ...request } = input;

  let outcome: LLMCallOutcome;
  try {
    const response = await getLLMProvider().chat(request);
    outcome = { status: "succeeded", response };
  } catch (err) {
    outcome = toFailureOutcome(err);
  }

  const record: LLMCallRecord = {
    turn,
    request,
    outcome,
  };
  await runtime.hooks.dispatch("llmCall", record);

  if (outcome.status === "failed") {
    throw infraError(outcome.error);
  }
  return outcome.response;
}
