import type { AgentMessage } from "./message.js";
import type { StreamDelta } from "./stream-delta.js";

/** LLM request message (narrow port; harness maps from product types). */
export interface LlmMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface LlmContext {
  system?: string;
  messages: LlmMessage[];
  tools?: readonly unknown[];
  /** Product harness attachment (e.g. protocol messages). Core ignores. */
  attachment?: unknown;
}

export interface StreamAssistantEvent {
  type: "text_delta" | "thinking_delta" | "tool_call" | "done" | "error" | "aborted";
  delta?: StreamDelta;
  message?: AgentMessage;
  errorMessage?: string;
}

/** Provider stream contract: must not throw; encode failures in events. */
export type StreamFn = (
  context: LlmContext,
  signal?: AbortSignal,
) => AsyncIterable<StreamAssistantEvent> | Promise<AsyncIterable<StreamAssistantEvent>>;

export interface ToolExecuteResult {
  content: string;
  isError?: boolean;
  details?: unknown;
}

export interface ToolExecutor {
  execute(
    toolCallId: string,
    toolName: string,
    args: unknown,
    signal?: AbortSignal,
    onUpdate?: (partial: unknown) => void,
  ): Promise<ToolExecuteResult>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: unknown;
}
