import type { LLMRequest, LLMResponse } from "../../llm/protocol/types.js";

export type ToolUseOutcome =
  | { status: "denied"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "succeeded"; output: string }
  | { status: "failed"; error: string };

export type LLMCallOutcome =
  | { status: "succeeded"; response: LLMResponse }
  | { status: "failed"; error: string };

export interface LLMCallRecord {
  turn: number;
  request: LLMRequest;
  outcome: LLMCallOutcome;
}

export interface ToolUseRecord {
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  outcome: ToolUseOutcome;
}

export type ToolUseContext = Omit<ToolUseRecord, "outcome">;
