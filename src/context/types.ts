import type { LLMResponse, Message, ToolSchema } from "../llm/protocol/types.js";

export type DetailLevel = "summary" | "struct" | "breakdown" | "full";

export interface ContextSnapshot {
  turn: number;
  messages: Message[];
  system: string;
  tools: ToolSchema[];
  modelId: string;
  response?: LLMResponse;
}

export interface TokenBreakdown {
  system: number;
  toolDefinitions: number;
  user: number;
  assistant: number;
  thinking: number;
  toolResults: number;
  total: number;
}

export interface ContextStructure {
  messageCount: number;
  toolCallCount: number;
  maxToolResultChars: number;
}

export interface ContextAlert {
  level: "warn" | "critical";
  message: string;
}

export interface ContextUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ContextTrend {
  deltaTokens: number;
  cumulativeTokens: number;
}

export interface MessageLineDetail {
  kind: "tool_result" | "tool_use" | "text" | "thinking";
  tokens: number;
  charCount: number;
  toolUseId?: string;
  toolName?: string;
  preview: string;
  body?: string;
}

export interface MessageLine {
  index: number;
  role: string;
  tokens: number;
  label: string;
  preview: string;
  details?: MessageLineDetail[];
}

export interface ContextReport {
  turn: number;
  modelId: string;
  limit: number;
  estimatedTokens: number;
  exactTokens?: number;
  headroom: number;
  percentUsed: number;
  breakdown: TokenBreakdown;
  structure: ContextStructure;
  messageLines: MessageLine[];
  trend: ContextTrend;
  alerts: ContextAlert[];
  usage?: ContextUsage;
}
