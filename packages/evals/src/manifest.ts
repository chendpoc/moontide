import crypto from "node:crypto";

import { resolveRoute } from "@moontide/llm";

import type { BudgetSummary } from "./budget.js";
import { harnessFeatureToggles } from "./intervention.js";
import { normalizeHarnessConfig } from "./harness-env.js";
import type {
  EvalArmManifest,
  EvalRouteManifest,
  EvalRunManifest,
} from "./manifest-types.js";
import type { EvalCaseDefinition, MoonTideEvalHarnessConfig } from "./types.js";
import type { ResolvedEvalIntervention } from "./intervention.js";

export type { EvalArmManifest, EvalRouteManifest, EvalRunManifest } from "./manifest-types.js";

export function suiteContentHash(version: string, cases: EvalCaseDefinition[]): string {
  const payload = `${version}\n${cases.map((caseDef) => caseDef.id).sort().join("\n")}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

function _routeManifest(modelId: string, jsonObject = false): EvalRouteManifest {
  const route = resolveRoute(modelId, { deepMode: false, jsonObject });
  return {
    logicalModelId: route.logicalModelId,
    providerPresetId: route.providerPresetId,
    vendorModelId: route.vendorModelId,
    adapterFamily: route.adapterFamily,
    thinkingLevel: route.thinkingLevel,
  };
}

function _armManifest(harness: MoonTideEvalHarnessConfig): EvalArmManifest {
  const normalized = normalizeHarnessConfig(harness);
  const model = normalized.model!;
  const judgeModel = normalized.judgeModel!;
  return {
    harnessName: harness.name,
    model,
    judgeModel,
    featureToggles: harnessFeatureToggles(harness),
    route: _routeManifest(model),
    judgeRoute: _routeManifest(judgeModel, true),
  };
}

export function buildEvalRunManifest(input: {
  suiteVersion: string;
  suitePath: string;
  cases: EvalCaseDefinition[];
  repetitions: number;
  gitSha: string;
  intervention: ResolvedEvalIntervention;
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
  comparable: boolean;
  comparabilityReason?: string;
  budget?: BudgetSummary;
  startedAt: string;
  finishedAt?: string;
}): EvalRunManifest {
  return {
    suiteVersion: input.suiteVersion,
    suitePath: input.suitePath,
    suiteHash: suiteContentHash(input.suiteVersion, input.cases),
    caseIds: input.cases.map((caseDef) => caseDef.id),
    repetitions: input.repetitions,
    gitSha: input.gitSha,
    intervention: input.intervention,
    baseline: _armManifest(input.baseline),
    candidate: _armManifest(input.candidate),
    comparable: input.comparable,
    comparabilityReason: input.comparabilityReason,
    budget: input.budget,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  };
}
