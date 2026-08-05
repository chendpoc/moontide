import { contextLimit } from "../config.js";
import {
  analyzeStructure,
  buildMessageLines,
  estimateBreakdown,
} from "./metrics.js";
import type { ContextAlert, ContextReport, ContextSnapshot } from "./types.js";

function buildAlerts(percentUsed: number): ContextAlert[] {
  const alerts: ContextAlert[] = [];
  if (percentUsed >= 90) {
    alerts.push({
      level: "critical",
      code: "compaction_recommended",
      percentUsed,
    });
  } else if (percentUsed >= 70) {
    alerts.push({
      level: "warn",
      code: "approaching_limit",
      percentUsed,
    });
  }
  return alerts;
}

export function buildContextReport(
  snapshot: ContextSnapshot,
  previousEstimated?: number,
): ContextReport {
  const breakdown = estimateBreakdown(snapshot);
  const estimatedTokens = breakdown.total;
  const limit = contextLimit();
  const headroom = Math.max(0, limit - estimatedTokens);
  const percentUsed = limit > 0 ? (estimatedTokens / limit) * 100 : 0;
  const hasBaseline = previousEstimated !== undefined;
  const deltaTokens = hasBaseline ? estimatedTokens - previousEstimated! : 0;

  return {
    turn: snapshot.turn,
    modelId: snapshot.modelId,
    limit,
    estimatedTokens,
    headroom,
    percentUsed,
    breakdown,
    structure: analyzeStructure(snapshot),
    messageLines: buildMessageLines(snapshot),
    trend: {
      deltaTokens,
      cumulativeTokens: estimatedTokens,
      hasBaseline,
    },
    alerts: buildAlerts(percentUsed),
    usage: snapshot.response?.usage
      ? {
          inputTokens: snapshot.response.usage.inputTokens,
          outputTokens: snapshot.response.usage.outputTokens,
        }
      : undefined,
  };
}

export function withExactTokens(report: ContextReport, exactTokens: number): ContextReport {
  const headroom = Math.max(0, report.limit - exactTokens);
  const percentUsed = report.limit > 0 ? (exactTokens / report.limit) * 100 : 0;
  return {
    ...report,
    exactTokens,
    headroom,
    percentUsed,
    alerts: buildAlerts(percentUsed),
  };
}

export function withUsage(
  report: ContextReport,
  usage: { inputTokens?: number; outputTokens?: number },
): ContextReport {
  return {
    ...report,
    usage,
  };
}
