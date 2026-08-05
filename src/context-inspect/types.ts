import type { LLMResponse, Message, ToolSchema } from "../llm/protocol/types.js";
import type { BudgetTierUsage } from "../context/composer/budget/types.js";
import type { MessageLineDetail } from "../session/block-registry.js";

export type { MessageLineDetail } from "../session/block-registry.js";

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

export type ContextAlertCode = "approaching_limit" | "compaction_recommended";

export interface ContextAlert {
  level: "warn" | "critical";
  code: ContextAlertCode;
  percentUsed: number;
}

export interface ContextUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ContextTrend {
  deltaTokens: number;
  /** Current estimated context size (same as estimatedTokens). */
  cumulativeTokens: number;
  hasBaseline: boolean;
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
  /** L2 dialogue tier usage percent (alerts / statusline). */
  percentUsed: number;
  /** L1+L2+L3 vs available input window (excludes L4/L5). */
  inputPercentUsed: number;
  /** L2_used / L2_limit. */
  dialoguePercentUsed: number;
  breakdown: TokenBreakdown;
  budgetTiers: BudgetTierUsage[];
  structure: ContextStructure;
  messageLines: MessageLine[];
  trend: ContextTrend;
  alerts: ContextAlert[];
  usage?: ContextUsage;
}
