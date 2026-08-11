import type { BudgetTier } from "@moontide/context-composer";
import type { ContextAlert, ContextAlertCode } from "./types.js";

export interface ContextCopy {
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
  inspectMessagesHeader: (count: number) => string;
  inspectUsageLine: (input: string, output: string) => string;
  exact: string;
  est: string;
  alert: (code: ContextAlertCode, percent: string) => string;
}

const CONTEXT_COPY: ContextCopy = {
  exact: "exact",
  est: "est",
  alert: (code, percent) =>
    code === "compaction_recommended"
      ? `Context at ${percent} — compaction recommended`
      : `Context at ${percent} — approaching limit`,
  inspectTurnSummary: (turn, tokenKind, tokens, limit, percent, headroom) =>
    `Turn ${turn} | ${tokenKind} ${tokens} / ${limit} tok (${percent}) | headroom ${headroom} tok`,
  inspectStructureLine: (count, toolCalls, delta) =>
    `messages=${count} tool_calls=${toolCalls} delta=${delta} tok`,
  inspectBreakdownHeader: "Breakdown:",
  inspectBreakdownSystem: "system",
  inspectBreakdownToolDefs: "tool_definitions",
  inspectBreakdownUser: "user",
  inspectBreakdownAssistant: "assistant",
  inspectBreakdownThinking: "thinking",
  inspectBreakdownToolResults: "tool_results",
  inspectBreakdownTotal: "total",
  inspectTierHeader: "Budget tiers (estimated):",
  inspectTierLine: (tier, used, limit, percent) => {
    const labels: Record<string, string> = {
      pinned: "L1 pinned",
      dialogue: "L2 dialogue",
      reference: "L3 reference",
      reserved: "L4 reserved",
      flex: "L5 flex",
    };
    const label = labels[tier] ?? tier;
    return `- ${label}: ${used} / ${limit} tok (${percent})`;
  },
  inspectTierWorkingSet: (used, limit) => `  └─ workingSet: ${used} / ${limit} tok`,
  inspectMessagesHeader: (count) => `messages[${count}]`,
  inspectUsageLine: (input, output) => `API usage: in=${input} tok out=${output} tok`,
};

export function contextCopy(): ContextCopy {
  return CONTEXT_COPY;
}

export function formatAlert(alert: ContextAlert): string {
  const copy = contextCopy();
  return copy.alert(alert.code, `${alert.percentUsed.toFixed(1)}%`);
}

export function fmtNum(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
