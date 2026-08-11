import type { AgentMessage } from "./message.js";
import type { LlmMessage, ToolExecuteResult } from "./ports.js";

export type { LlmMessage };

export interface BeforeToolCallParams {
  toolCallId: string;
  toolName: string;
  args: unknown;
  assistantMessage: AgentMessage;
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallParams {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result: ToolExecuteResult;
  isError: boolean;
}

export interface AfterToolCallResult {
  content?: string;
  isError?: boolean;
  details?: unknown;
  modelAppends?: string[];
}

export interface ShouldStopAfterTurnParams {
  turnAssistantMessage: AgentMessage;
  toolResults: readonly AgentMessage[];
  messages: readonly AgentMessage[];
}

export interface CompileTurnContextParams {
  messages: readonly AgentMessage[];
  turn: number;
}

/** Per-turn compile result consumed by resolveTurnContext and StreamFn. */
export interface TurnCompileResult {
  system?: string;
  tools?: readonly unknown[];
  messages: readonly LlmMessage[];
  attachment?: unknown;
}

/** Run-scoped frozen strategy. Assembled via resolveRunConfig before each run. */
export interface RunConfig {
  compileTurnContext?: (
    params: CompileTurnContextParams,
    signal?: AbortSignal,
  ) => TurnCompileResult | Promise<TurnCompileResult>;
  convertToLlm?: (
    messages: readonly AgentMessage[],
  ) => LlmMessage[] | Promise<LlmMessage[]>;
  transformContext?: (
    messages: readonly AgentMessage[],
    signal?: AbortSignal,
  ) => readonly AgentMessage[] | Promise<readonly AgentMessage[]>;
  beforeToolCall?: (
    params: BeforeToolCallParams,
    signal?: AbortSignal,
  ) => BeforeToolCallResult | undefined | Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    params: AfterToolCallParams,
    signal?: AbortSignal,
  ) => AfterToolCallResult | undefined | Promise<AfterToolCallResult | undefined>;
  shouldStopAfterTurn?: (
    params: ShouldStopAfterTurnParams,
    signal?: AbortSignal,
  ) => boolean | Promise<boolean>;
}

/** Partial sources merged by resolveRunConfig. */
export type RunConfigSource = Partial<RunConfig>;
