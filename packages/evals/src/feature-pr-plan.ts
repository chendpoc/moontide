import type { EvalCaseCategory, FeatureSurface } from "./types.js";

export interface FeaturePrPrimaryPlan {
  suitePath: string;
  featureSurface?: FeatureSurface;
  category: EvalCaseCategory;
  description: string;
}

/** Declarative map: feature surface → primary suite (guard is always v2/regression). */
export const FEATURE_PR_PRIMARY_PLAN: Record<FeatureSurface, FeaturePrPrimaryPlan> = {
  deep_protocol: {
    suitePath: "v2/deep_task",
    featureSurface: "deep_protocol",
    category: "deep_task",
    description: "Deep protocol reminders, work_mem, structured output",
  },
  tooling: {
    suitePath: "v2/coding",
    featureSurface: "tooling",
    category: "coding",
    description: "Tool use: grep, read, edit",
  },
  context: {
    suitePath: "v2/coding",
    featureSurface: "context",
    category: "coding",
    description: "Context recall, inspect_context, budget",
  },
  prompt: {
    suitePath: "v2/deep_task",
    featureSurface: "prompt",
    category: "deep_task",
    description: "Prompt / instruction adherence on deep tasks",
  },
  model_only: {
    suitePath: "v2/general",
    featureSurface: "model_only",
    category: "general",
    description: "General knowledge guard (no unnecessary tools)",
  },
};

export const FEATURE_PR_GUARD_SUITE = "v2/regression" as const;

export function listFeatureSurfaces(): FeatureSurface[] {
  return Object.keys(FEATURE_PR_PRIMARY_PLAN) as FeatureSurface[];
}

export function featurePrPrimaryPlan(surface: FeatureSurface): FeaturePrPrimaryPlan {
  const plan = FEATURE_PR_PRIMARY_PLAN[surface];
  if (!plan) {
    throw new Error(`Unknown feature surface: ${surface}`);
  }
  return plan;
}
