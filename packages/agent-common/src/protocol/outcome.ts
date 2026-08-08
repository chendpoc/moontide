import type { AgentMessage } from "./message.js";

export type ErrorCode =
  | "user_abort"
  | "provider_error"
  | "tool_error"
  | "context_exhausted";

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type Outcome =
  | { kind: "success"; messages: readonly AgentMessage[] }
  | { kind: "aborted"; messages: readonly AgentMessage[] }
  | { kind: "error"; messages: readonly AgentMessage[]; error: ErrorInfo };
