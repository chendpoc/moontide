import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ToolSchema } from "../../llm/protocol/types.js";

import { chat } from "../../llm/client/anthropic.js";
import { hookDispatcher } from "../hooks/index.js";
import type { LLMCallOutcome, LLMCallRecord } from "./types.js";

export interface RunLLMInput {
  turn: number;
  messages: MessageParam[];
  system: string;
  tools: ToolSchema[];
}

export async function runLLM(input: RunLLMInput) {
  const { turn, messages, system, tools } = input;

  let outcome: LLMCallOutcome;
  try {
    const response = await chat(messages, tools as Tool[], system);
    outcome = { status: "succeeded", response };
  } catch (err) {
    outcome = {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const record: LLMCallRecord = {
    turn,
    request: { messages, system, tools },
    outcome,
  };
  await hookDispatcher.dispatch("llmCall", record);

  if (outcome.status === "failed") {
    throw new Error(outcome.error);
  }
  return outcome.response;
}
