import type { ContextAlertCode } from "../../context-inspect/types.js";
import type { BudgetTier } from "../../context/composer/budget/types.js";

export interface ContextCopy {
  title: (turn: string, phase?: "pre" | "post") => string;
  window: string;
  billing: string;
  change: string;
  input: string;
  output: string;
  billingDelta: (delta: string) => string;
  changeSinceLastTurn: (delta: string) => string;
  exact: string;
  est: string;
  tokUnit: string;
  /** Visible pad width for composition label column. */
  compositionLabelPad: number;
  compositionHeader: string;
  system: string;
  toolDefs: string;
  user: string;
  assistant: string;
  thinking: string;
  toolResults: string;
  messageCount: (count: number) => string;
  toolCallCount: (count: number) => string;
  compact: (mode: string, before: string, after: string, saved: string) => string;
  alert: (code: ContextAlertCode, percent: string) => string;
  inspectTurnSummary: (
    turn: number,
    tokenKind: string,
    tokens: string,
    limit: string,
    percent: string,
    headroom: string,
  ) => string;
  inspectStructureLine: (count: number, toolCalls: number, delta: string) => string;
  inspectBreakdownHeader: string;
  inspectBreakdownSystem: string;
  inspectBreakdownToolDefs: string;
  inspectBreakdownUser: string;
  inspectBreakdownAssistant: string;
  inspectBreakdownThinking: string;
  inspectBreakdownToolResults: string;
  inspectBreakdownTotal: string;
  inspectTierHeader: string;
  inspectTierLine: (
    tier: BudgetTier,
    used: string,
    limit: string,
    percent: string,
  ) => string;
  inspectTierWorkingSet: (used: string, limit: string) => string;
  tierLabel: (tier: BudgetTier) => string;
  inspectMessagesHeader: (count: number) => string;
  inspectUsageLine: (input: string, output: string) => string;
}
