import fs from "node:fs";
import path from "node:path";

import type {
  EvalCaseDefinition,
  EvalRunPhase,
  FeatureSurface,
  HarnessConfigFile,
  JudgeMode,
  MoonTideEvalHarnessConfig,
} from "./types.js";
import type { EvalInterventionMode } from "./intervention.js";
import {
  DEFAULT_EVAL_AGENT_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  normalizeHarnessConfig,
} from "./harness-env.js";

export type { EvalRunPhase, JudgeMode };

export interface ParsedEvalCliArgs {
  suitePaths: string[];
  repetitions: number;
  caseId?: string;
  caseFilter?: string;
  featureSurface?: FeatureSurface;
  judgeMode: JudgeMode;
  judgeBatchSize: number;
  agentConcurrency: number;
  phase: EvalRunPhase;
  judgeFromPath?: string;
  artifactBaseDir?: string;
  recordHttpFixtures: boolean;
  baselineFromPath?: string;
  writeBaselinePath?: string;
  mergeGate: boolean;
  verbose: boolean;
  interventionMode?: EvalInterventionMode;
  budgetMicroCny?: number;
  maxCases?: number;
  harness: {
    baseline: MoonTideEvalHarnessConfig;
    candidate: MoonTideEvalHarnessConfig;
  };
}

const DEFAULT_REPETITIONS = 2;
const DEFAULT_JUDGE_BATCH = 8;
export const MAX_AGENT_CONCURRENCY = 10;
const DEFAULT_AGENT_CONCURRENCY = 4;

export function resolveAgentConcurrency(agentConcurrency?: number): number {
  if (agentConcurrency === undefined || !Number.isFinite(agentConcurrency)) {
    return DEFAULT_AGENT_CONCURRENCY;
  }
  return Math.max(1, Math.min(MAX_AGENT_CONCURRENCY, Math.floor(agentConcurrency)));
}

export function resolveJudgeBatchSize(
  judgeMode: JudgeMode,
  judgeBatchSize?: number,
): number {
  if (judgeMode === "single") {
    return 1;
  }
  if (judgeBatchSize !== undefined && Number.isFinite(judgeBatchSize) && judgeBatchSize >= 1) {
    return Math.floor(judgeBatchSize);
  }
  return DEFAULT_JUDGE_BATCH;
}

/** Exact `caseId` wins over substring `caseFilter`. */
export function selectSuiteCases(
  cases: EvalCaseDefinition[],
  options: { caseId?: string; caseFilter?: string; featureSurface?: FeatureSurface },
  suiteLabel: string,
): EvalCaseDefinition[] {
  if (options.caseId) {
    const match = cases.filter((caseDef) => caseDef.id === options.caseId);
    if (match.length === 0) {
      throw new Error(`Case id not found in ${suiteLabel}: ${options.caseId}`);
    }
    return match;
  }

  let filtered = cases;
  if (options.featureSurface) {
    filtered = filtered.filter((caseDef) =>
      caseDef.featureSurface?.includes(options.featureSurface!),
    );
    if (filtered.length === 0) {
      throw new Error(
        `No case with featureSurface "${options.featureSurface}" in ${suiteLabel}`,
      );
    }
  }
  if (options.caseFilter) {
    filtered = filtered.filter((caseDef) => caseDef.id.includes(options.caseFilter!));
    if (filtered.length === 0) {
      throw new Error(`No case id contains "${options.caseFilter}" in ${suiteLabel}`);
    }
  }
  return filtered;
}

function _argValue(args: string[], prefix: string): string | undefined {
  const hit = args.find((arg) => arg.startsWith(prefix));
  if (!hit) {
    return undefined;
  }
  return hit.slice(prefix.length);
}

function _flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function _resolveHarnessConfig(args: string[]): {
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
} {
  const configPath = _argValue(args, "--harness-config=");
  if (configPath) {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as HarnessConfigFile;
    return {
      baseline: normalizeHarnessConfig(parsed.baseline),
      candidate: normalizeHarnessConfig(parsed.candidate),
    };
  }

  const baselineDisable = _flag(args, "--baseline-disable-protocol-reminders") ||
    !_flag(args, "--baseline-enable-protocol-reminders");
  const candidateDisable = _flag(args, "--candidate-disable-protocol-reminders");

  const agentModel = _argValue(args, "--agent-model=") ?? DEFAULT_EVAL_AGENT_MODEL;
  const judgeModel = _argValue(args, "--judge-model=") ?? DEFAULT_EVAL_JUDGE_MODEL;

  return {
    baseline: normalizeHarnessConfig({
      name: _argValue(args, "--baseline-name=") ?? "baseline",
      disableProtocolReminders: baselineDisable,
      model: agentModel,
      judgeModel,
    }),
    candidate: normalizeHarnessConfig({
      name: _argValue(args, "--candidate-name=") ?? "with-feature",
      disableProtocolReminders: candidateDisable,
      model: agentModel,
      judgeModel,
    }),
  };
}

export function parseEvalCliArgs(argv: string[]): ParsedEvalCliArgs {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const suiteArg = positional[0] ?? "v1/B-deep-protocol.json";
  const suitePaths =
    suiteArg === "v2"
      ? [
          "v2/coding",
          "v2/exploration",
          "v2/deep_task",
          "v2/general",
          "v2/regression",
          "v2/external_research",
        ]
      : [suiteArg];

  const repetitionsRaw = _argValue(argv, "--repetitions=");
  const repetitions = repetitionsRaw ? Number(repetitionsRaw) : DEFAULT_REPETITIONS;

  const judgeModeRaw = _argValue(argv, "--judge-mode=");
  const judgeMode: JudgeMode = judgeModeRaw === "single" ? "single" : "batch";

  const judgeBatchRaw = _argValue(argv, "--judge-batch=");
  const judgeBatchSize = resolveJudgeBatchSize(
    judgeMode,
    judgeBatchRaw ? Number(judgeBatchRaw) : undefined,
  );

  const agentConcurrencyRaw = _argValue(argv, "--agent-concurrency=");
  const agentConcurrency = resolveAgentConcurrency(
    agentConcurrencyRaw ? Number(agentConcurrencyRaw) : undefined,
  );

  const judgeFromPath = _argValue(argv, "--judge-from=");
  const agentOnly = _flag(argv, "--agent-only");
  const judgeOnly = _flag(argv, "--judge-only") || Boolean(judgeFromPath);

  if (agentOnly && judgeOnly) {
    throw new Error("Use either --agent-only or --judge-only, not both");
  }

  let phase: EvalRunPhase = "full";
  if (agentOnly) {
    phase = "agent-only";
  } else if (judgeOnly) {
    phase = "judge-only";
    if (!judgeFromPath) {
      throw new Error("--judge-only requires --judge-from=<pairs.jsonl>");
    }
  }

  const writeBaselinePath = _flag(argv, "--write-baseline")
    ? _argValue(argv, "--write-baseline=") ?? path.join("packages/evals/baseline.json")
    : undefined;

  const interventionRaw = _argValue(argv, "--intervention=");
  let interventionMode: EvalInterventionMode | undefined;
  if (interventionRaw === "toggle") {
    interventionMode = interventionRaw;
  } else if (interventionRaw === "revision") {
    throw new Error(
      "revision intervention is not supported; use harness toggle (--harness-config=) on the same checkout",
    );
  } else if (interventionRaw !== undefined) {
    throw new Error(`Invalid --intervention=${interventionRaw} (use toggle)`);
  }

  if (_argValue(argv, "--base-ref=")) {
    throw new Error(
      "--base-ref is not supported; use harness toggle (--harness-config=) for A/B on the same checkout",
    );
  }

  const budgetRaw = _argValue(argv, "--budget-micro-cny=");
  const budgetMicroCny = budgetRaw ? Number(budgetRaw) : undefined;
  if (budgetRaw && (!Number.isFinite(budgetMicroCny!) || budgetMicroCny! <= 0)) {
    throw new Error(`Invalid --budget-micro-cny=${budgetRaw}`);
  }

  const maxCasesRaw = _argValue(argv, "--max-cases=");
  const maxCases = maxCasesRaw ? Number(maxCasesRaw) : undefined;
  if (maxCasesRaw && (!Number.isFinite(maxCases!) || maxCases! <= 0)) {
    throw new Error(`Invalid --max-cases=${maxCasesRaw}`);
  }

  return {
    suitePaths,
    repetitions: Number.isFinite(repetitions) ? repetitions : DEFAULT_REPETITIONS,
    caseId: _argValue(argv, "--case-id="),
    caseFilter: _argValue(argv, "--case="),
    featureSurface: _argValue(argv, "--feature-surface=") as FeatureSurface | undefined,
    judgeMode,
    judgeBatchSize,
    agentConcurrency,
    phase,
    judgeFromPath,
    recordHttpFixtures: _flag(argv, "--record-http-fixtures"),
    baselineFromPath: _argValue(argv, "--baseline-from="),
    writeBaselinePath,
    mergeGate: _flag(argv, "--merge-gate"),
    verbose: _flag(argv, "--verbose"),
    interventionMode,
    budgetMicroCny,
    maxCases,
    harness: _resolveHarnessConfig(argv),
  };
}

export const AGENT_ONLY_VERDICT = {
  score: 3 as const,
  winner: "tie" as const,
  rationale: "agent-only run; judge skipped",
};
