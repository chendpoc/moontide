import type { BudgetSummary } from "./budget.js";
import type { ResolvedEvalIntervention } from "./intervention.js";

export interface EvalRouteManifest {
  logicalModelId: string;
  providerPresetId: string;
  vendorModelId: string;
  adapterFamily: string;
  thinkingLevel: "off" | "low" | "medium" | "high";
}

export interface EvalArmManifest {
  harnessName: string;
  model: string;
  judgeModel: string;
  featureToggles: Record<string, boolean>;
  route: EvalRouteManifest;
  judgeRoute: EvalRouteManifest;
}

export interface EvalRunManifest {
  suiteVersion: string;
  suitePath: string;
  suiteHash: string;
  caseIds: string[];
  repetitions: number;
  gitSha: string;
  intervention: ResolvedEvalIntervention;
  baseline: EvalArmManifest;
  candidate: EvalArmManifest;
  comparable: boolean;
  comparabilityReason?: string;
  budget?: BudgetSummary;
  startedAt: string;
  finishedAt?: string;
}
