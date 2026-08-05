import type { ManifestAlert } from "../types.js";
import type { BudgetPolicy } from "./types.js";
import { findTierUsage } from "./policy.js";

export function buildBudgetAlerts(policy: BudgetPolicy): ManifestAlert[] {
  const alerts: ManifestAlert[] = [];
  const pinned = findTierUsage(policy, "pinned");
  if (pinned.estimatedTokens > pinned.limitTokens) {
    alerts.push({
      code: "pinned_over_budget",
      message: `Pinned tier uses ${pinned.estimatedTokens} tokens (limit ${pinned.limitTokens})`,
    });
  }
  const reference = findTierUsage(policy, "reference");
  if (reference.estimatedTokens > reference.limitTokens) {
    alerts.push({
      code: "reference_over_budget",
      message: `Reference tier uses ${reference.estimatedTokens} tokens (limit ${reference.limitTokens})`,
    });
  }
  return alerts;
}
