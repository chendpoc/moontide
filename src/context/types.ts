import type { Message, MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

export type DetailLevel = "summary" | "struct" | "breakdown" | "full";

export interface ContextSnapshot {
  turn: number;
  messages: MessageParam[];
  system: string;
  tools: Tool[];
  modelId: string;
  response?: Message;
}

export interface TokenBreakdown {
  system: number;
  toolSchemas: number;
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

export interface MessageLine {
  index: number;
  role: string;
  tokens: number;
  label: string;
  preview: string;
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
