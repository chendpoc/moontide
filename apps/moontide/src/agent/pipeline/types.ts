export type { LLMCallOutcome, LLMCallRecord } from "@moontide/llm";

export type ToolUseOutcome =
  | { status: "denied"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "succeeded"; output: string }
  | { status: "failed"; error: string };

export interface ToolUseRecord {
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  outcome: ToolUseOutcome;
}

export type ToolUseContext = Omit<ToolUseRecord, "outcome">;
