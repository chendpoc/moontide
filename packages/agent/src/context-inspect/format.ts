import {
  contextCopy,
  fmtNum,
  formatAlert,
  formatPercent,
} from "./copy.js";
import type { BudgetTierUsage } from "@moontide/context-composer";
import type { ContextReport, DetailLevel } from "./types.js";

function formatTierLines(tiers: BudgetTierUsage[]): string[] {
  const copy = contextCopy();
  const lines: string[] = [copy.inspectTierHeader];
  for (const tier of tiers) {
    const pct =
      tier.limitTokens > 0
        ? formatPercent((tier.estimatedTokens / tier.limitTokens) * 100)
        : formatPercent(0);
    lines.push(copy.inspectTierLine(tier.tier, fmtNum(tier.estimatedTokens), fmtNum(tier.limitTokens), pct));
    const ws = tier.subAccounts?.workingSet;
    if (ws) {
      lines.push(copy.inspectTierWorkingSet(fmtNum(ws.estimatedTokens), fmtNum(ws.limitTokens)));
    }
  }
  return lines;
}

export function getSummary(report: ContextReport): string {
  const copy = contextCopy();
  const dialogueTier = report.budgetTiers.find((tier) => tier.tier === "dialogue");
  const tokenLabel = report.exactTokens ?? dialogueTier?.estimatedTokens ?? report.estimatedTokens;
  const tokenLimit = dialogueTier?.limitTokens ?? report.limit;
  const tokenKind = report.exactTokens !== undefined ? copy.exact : copy.est;
  const headroom =
    dialogueTier !== undefined
      ? Math.max(0, dialogueTier.limitTokens - dialogueTier.estimatedTokens)
      : report.headroom;
  return [
    copy.inspectTurnSummary(
      report.turn,
      tokenKind,
      fmtNum(tokenLabel),
      fmtNum(tokenLimit),
      formatPercent(report.dialoguePercentUsed),
      fmtNum(headroom),
    ),
    copy.inspectStructureLine(
      report.structure.messageCount,
      report.structure.toolCallCount,
      fmtNum(report.trend.deltaTokens),
    ),
    report.alerts.length > 0 ? report.alerts.map((alert) => formatAlert(alert)).join("; ") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getStruct(report: ContextReport): string {
  const copy = contextCopy();
  const lines = [
    getSummary(report),
    `├─ ${copy.inspectBreakdownSystem.padEnd(16)} ${fmtNum(report.breakdown.system)} tok`,
    `├─ ${copy.inspectBreakdownToolDefs.padEnd(16)} ${fmtNum(report.breakdown.toolDefinitions)} tok`,
    `└─ ${copy.inspectMessagesHeader(report.structure.messageCount)}`,
  ];

  for (const [idx, line] of report.messageLines.entries()) {
    const prefix = idx === report.messageLines.length - 1 ? "   └─" : "   ├─";
    lines.push(
      `${prefix} [${line.index}] ${line.role.padEnd(9)} ${fmtNum(line.tokens).padStart(6)} tok  ${line.label}  "${line.preview}"`,
    );
  }

  return lines.join("\n");
}

export function getBreakdown(report: ContextReport): string {
  const copy = contextCopy();
  const { breakdown: b } = report;
  return [
    getSummary(report),
    "",
    copy.inspectBreakdownHeader,
    `- ${copy.inspectBreakdownSystem}:       ${fmtNum(b.system)}`,
    `- ${copy.inspectBreakdownToolDefs}: ${fmtNum(b.toolDefinitions)}`,
    `- ${copy.inspectBreakdownUser}:         ${fmtNum(b.user)}`,
    `- ${copy.inspectBreakdownAssistant}:    ${fmtNum(b.assistant)}`,
    `- ${copy.inspectBreakdownThinking}:     ${fmtNum(b.thinking)}`,
    `- ${copy.inspectBreakdownToolResults}: ${fmtNum(b.toolResults)}`,
    `- ${copy.inspectBreakdownTotal}:        ${fmtNum(b.total)}`,
    "",
    ...formatTierLines(report.budgetTiers),
  ].join("\n");
}

export function getFull(report: ContextReport): string {
  const copy = contextCopy();
  const usageLine =
    report.usage?.inputTokens !== undefined
      ? `\n${copy.inspectUsageLine(fmtNum(report.usage.inputTokens), fmtNum(report.usage.outputTokens ?? 0))}`
      : "";

  return `${getBreakdown(report)}${usageLine}\n\n${getStruct(report)}`;
}

export function formatContext(report: ContextReport, detailLevel: DetailLevel = "summary"): string {
  switch (detailLevel) {
    case "summary":
      return getSummary(report);
    case "struct":
      return getStruct(report);
    case "breakdown":
      return getBreakdown(report);
    case "full":
      return getFull(report);
  }
}
