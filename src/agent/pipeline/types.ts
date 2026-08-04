import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ToolSchema } from "../../llm/protocol/types.js";

export type ToolUseOutcome =
  | { status: "denied"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "succeeded"; output: string }
  | { status: "failed"; error: string };

export type LLMCallOutcome =
  | { status: "succeeded"; response: Message }
  | { status: "failed"; error: string };

export interface LLMCallRecord {
  turn: number;
  request: {
    messages: MessageParam[];
    system: string;
    tools: ToolSchema[];
  };
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

