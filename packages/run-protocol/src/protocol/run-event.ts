import type { AgentMessage, ToolResultMessage } from "./message.js";
import type { Outcome } from "./outcome.js";
import type { StreamDelta } from "./stream-delta.js";

/** Payload for llm_call_end (Harness publishes after runLLM). */
export type LlmCallEndRecord = {
  turn: number;
  request: unknown;
  outcome: unknown;
};

export type RunEvent =
  | { type: "run_start" }
  | { type: "run_end"; outcome: Outcome }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: readonly ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: StreamDelta }
  | { type: "message_end"; message: AgentMessage }
  | { type: "llm_call_end"; record: LlmCallEndRecord }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partialResult: unknown }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    };
