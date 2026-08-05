import { contextBudgetFlexEnabled } from "../config.js";
import {
  findTierUsage,
  resolveBudgetPolicy,
  sumInputTierTokens,
} from "../context/composer/budget/index.js";
import { resolveModelProfile } from "../llm/models/resolve.js";
import {
  analyzeStructure,
  buildMessageLines,
  estimateBreakdown,
} from "./metrics.js";
import type { ContextAlert, ContextReport, ContextSnapshot } from "./types.js";

function buildAlerts(dialoguePercentUsed: number): ContextAlert[] {
  const alerts: ContextAlert[] = [];
  if (dialoguePercentUsed >= 90) {
    alerts.push({
      level: "critical",
      code: "compaction_recommended",
      percentUsed: dialoguePercentUsed,
    });
  } else if (dialoguePercentUsed >= 70) {
    alerts.push({
      level: "warn",
      code: "approaching_limit",
      percentUsed: dialoguePercentUsed,
    });
  }
  return alerts;
}

function resolveInputWindow(policy: ReturnType<typeof resolveBudgetPolicy>): number {
  const reserved = findTierUsage(policy, "reserved").limitTokens;
  const flex = findTierUsage(policy, "flex").limitTokens;
  return Math.max(0, policy.contextWindow - reserved - flex);
}

export function buildContextReport(
  snapshot: ContextSnapshot,
  previousEstimated?: number,
): ContextReport {
  const breakdown = estimateBreakdown(snapshot);
  const estimatedTokens = breakdown.total;
  const modelProfile = resolveModelProfile(snapshot.modelId);
  const budgetPolicy = resolveBudgetPolicy({
    modelProfile,
    system: snapshot.system,
    tools: snapshot.tools,
    messages: snapshot.messages,
    includeFlex: contextBudgetFlexEnabled(),
  });

  const limit = budgetPolicy.contextWindow;
  const inputTokens = sumInputTierTokens(budgetPolicy);
  const inputWindow = resolveInputWindow(budgetPolicy);
  const dialogueTier = findTierUsage(budgetPolicy, "dialogue");
  const dialoguePercentUsed =
    dialogueTier.limitTokens > 0
      ? (dialogueTier.estimatedTokens / dialogueTier.limitTokens) * 100
      : 0;
  const inputPercentUsed = inputWindow > 0 ? (inputTokens / inputWindow) * 100 : 0;
  const headroom = Math.max(0, limit - estimatedTokens);
  const hasBaseline = previousEstimated !== undefined;
  const deltaTokens = hasBaseline ? estimatedTokens - previousEstimated! : 0;

  return {
    turn: snapshot.turn,
    modelId: snapshot.modelId,
    limit,
    estimatedTokens,
    headroom,
    percentUsed: dialoguePercentUsed,
    inputPercentUsed,
    dialoguePercentUsed,
    breakdown,
    budgetTiers: budgetPolicy.tiers,
    structure: analyzeStructure(snapshot),
    messageLines: buildMessageLines(snapshot),
    trend: {
      deltaTokens,
      cumulativeTokens: estimatedTokens,
      hasBaseline,
    },
    alerts: buildAlerts(dialoguePercentUsed),
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
  return {
    ...report,
    exactTokens,
    headroom,
    alerts: buildAlerts(report.dialoguePercentUsed),
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
