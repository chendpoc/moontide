import path from "node:path";
import { fileURLToPath } from "node:url";

import { BudgetLedger, EVAL_EXIT_BUDGET_EXCEEDED } from "./budget.js";
import { checkArmsComparable } from "./comparability.js";
import { normalizeHarnessConfig } from "./harness-env.js";
import { buildEvalRunManifest } from "./manifest.js";
import type { ResolvedEvalIntervention } from "./intervention.js";
import { compareToBaseline, loadBaseline, shouldFailMergeGate, writeBaseline } from "./baseline.js";
import { AGENT_ONLY_VERDICT, selectSuiteCases } from "./cli-args.js";
import { runConcurrent } from "./concurrency.js";
import { gradePairBatch } from "./graders/index.js";
import { runProtocolChecks } from "./graders/protocol-checks.js";
import { gradeWithRubric } from "./graders/rubric-judge.js";
import { spawnAgentJob } from "./agent-worker.js";
import { createArtifactDir, gitSha, readPairsJsonl, writeEvalReport } from "./artifacts.js";
import { createMoonTideEvalHarness } from "./moontide-harness.js";
import { evalLog, evalVerbose, formatAgentJobSummary } from "./progress-log.js";
import { loadSuite, suitePath } from "./suite-loader.js";
import { formatCompareSummary, summarizeComparison } from "./summary.js";
import type {
  EvalPairRecord,
  EvalReport,
  EvalRunPhase,
  FeatureSurface,
  JudgeMode,
  MoonTideEvalHarnessConfig,
  PairGradeItem,
} from "./types.js";

export interface RunSuiteOptions {
  suitePath: string;
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
  repetitions?: number;
  artifactBaseDir?: string;
  artifactDir?: string;
  caseFilter?: string;
  caseId?: string;
  featureSurface?: FeatureSurface;
  judgeMode?: JudgeMode;
  judgeBatchSize?: number;
  agentConcurrency?: number;
  phase?: EvalRunPhase;
  judgeFromPath?: string;
  recordHttpFixtures?: boolean;
  baselineFromPath?: string;
  writeBaselinePath?: string;
  mergeGate?: boolean;
  verbose?: boolean;
  intervention?: ResolvedEvalIntervention;
  budgetMicroCny?: number;
  maxCases?: number;
}

async function _runAgentPairs(
  options: RunSuiteOptions,
  cases: ReturnType<typeof loadSuite>["cases"],
  repetitions: number,
  artifactDir: string,
  budget?: BudgetLedger,
): Promise<PairGradeItem[]> {
  const jobs: Array<() => Promise<PairGradeItem>> = [];
  const verbose = options.verbose ?? false;
  const totalJobs = cases.length * repetitions;
  let jobIndex = 0;
  const agentModel = normalizeHarnessConfig(options.baseline).model!;

  for (const caseDef of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const rep = repetition;
      const index = jobIndex;
      jobIndex += 1;
      jobs.push(async () => {
        const label = `${caseDef.id} rep=${rep}`;
        evalLog(`agent start ${index + 1}/${totalJobs} case=${label}`);
        const wallStart = Date.now();
        const result = await spawnAgentJob({
              baseline: options.baseline,
              candidate: options.candidate,
              caseDef,
              repetition: rep,
              artifactDir,
              recordHttpFixtures: options.recordHttpFixtures,
              verbose,
            });
        budget?.recordAgentOutput(result.baseline, agentModel);
        budget?.recordAgentOutput(result.candidate, agentModel);
        if (budget?.exceedsLimit()) {
          throw new EvalBudgetExceededError(budget.summary());
        }
        const wallMs = Date.now() - wallStart;
        const summary = formatAgentJobSummary(result.baseline, result.candidate);
        evalLog(`agent done ${index + 1}/${totalJobs} case=${label} wall=${wallMs}ms ${summary}`);
        return result;
      });
    }
  }

  const concurrency = options.agentConcurrency ?? 4;
  evalLog(`agent queue jobs=${jobs.length} concurrency=${concurrency} (subprocess)`);
  return runConcurrent(jobs, concurrency);
}

export class EvalBudgetExceededError extends Error {
  readonly exitCode = EVAL_EXIT_BUDGET_EXCEEDED;
  readonly summary: ReturnType<BudgetLedger["summary"]>;

  constructor(summary: ReturnType<BudgetLedger["summary"]>) {
    super(
      `Eval budget exceeded: cost=${summary.costMicroCny.toFixed(0)} micro-CNY` +
        (summary.budgetMicroCny !== undefined ? ` limit=${summary.budgetMicroCny}` : ""),
    );
    this.name = "EvalBudgetExceededError";
    this.summary = summary;
  }
}

function _caseDefById(
  cases: ReturnType<typeof loadSuite>["cases"],
): Map<string, (typeof cases)[number]> {
  return new Map(cases.map((caseDef) => [caseDef.id, caseDef]));
}

async function _enrichGrade(
  item: PairGradeItem,
  grade: Awaited<ReturnType<typeof gradePairBatch>>[number],
): Promise<EvalPairRecord> {
  const protocolChecks = {
    baseline: runProtocolChecks(item.baseline),
    candidate: runProtocolChecks(item.candidate),
  };

  let rubricChecks: EvalPairRecord["rubricChecks"];
  if (item.caseDef.rubricBullets?.length && item.caseDef.gradingMode === "subjective") {
    const [baselineRubric, candidateRubric] = await Promise.all([
      gradeWithRubric(item.baseline, item.caseDef),
      gradeWithRubric(item.candidate, item.caseDef),
    ]);
    if (baselineRubric && candidateRubric) {
      rubricChecks = { baseline: baselineRubric, candidate: candidateRubric };
    }
  }

  return {
    caseId: item.caseDef.id,
    category: item.caseDef.category,
    gradingMode: item.caseDef.gradingMode,
    featureSurface: item.caseDef.featureSurface,
    expectLift: item.caseDef.expectLift,
    repetition: item.baseline.repetition,
    baseline: item.baseline,
    candidate: item.candidate,
    verdict: grade.verdict,
    objectiveChecks: grade.objectiveChecks,
    protocolChecks,
    rubricChecks,
    judgeModel: grade.judgeModel,
  };
}

async function _pairsFromPendingEnriched(
  pending: PairGradeItem[],
  graded: Awaited<ReturnType<typeof gradePairBatch>>,
  phase: EvalRunPhase,
): Promise<EvalPairRecord[]> {
  const pairs: EvalPairRecord[] = [];
  for (let i = 0; i < pending.length; i += 1) {
    const item = pending[i]!;
    const grade = graded[i]!;
    const pair = await _enrichGrade(item, grade);
    pairs.push({ ...pair, phase });
  }
  return pairs;
}

function _agentOnlyPairs(pending: PairGradeItem[]): EvalPairRecord[] {
  return pending.map((item) => ({
    caseId: item.caseDef.id,
    category: item.caseDef.category,
    gradingMode: item.caseDef.gradingMode,
    featureSurface: item.caseDef.featureSurface,
    expectLift: item.caseDef.expectLift,
    repetition: item.baseline.repetition,
    baseline: item.baseline,
    candidate: item.candidate,
    verdict: { ...AGENT_ONLY_VERDICT },
    phase: "agent-only" as const,
  }));
}

export interface RunSuiteAbResult {
  report: EvalReport;
  mergeGateFailed: boolean;
}

export async function runSuiteAb(options: RunSuiteOptions): Promise<EvalReport> {
  const result = await runSuiteAbWithGate(options);
  return result.report;
}

export async function runSuiteAbWithGate(options: RunSuiteOptions): Promise<RunSuiteAbResult> {
  const startedAt = new Date().toISOString();
  const suite = loadSuite(options.suitePath);
  const repetitions = options.repetitions ?? 1;
  const phase = options.phase ?? "full";
  const suiteLabel = suitePath(options.suitePath);
  let cases = selectSuiteCases(
    suite.cases,
    {
      caseId: options.caseId,
      caseFilter: options.caseFilter,
      featureSurface: options.featureSurface,
    },
    suiteLabel,
  );
  if (options.maxCases !== undefined && options.maxCases > 0) {
    cases = cases.slice(0, options.maxCases);
  }
  const caseById = _caseDefById(suite.cases);
  const comparability = checkArmsComparable(options.baseline, options.candidate);
  const budget =
    options.budgetMicroCny !== undefined ? new BudgetLedger(options.budgetMicroCny) : undefined;
  const agentModel = normalizeHarnessConfig(options.baseline).model!;
  const judgeModel = normalizeHarnessConfig(options.baseline).judgeModel!;

  const defaultRunsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../runs",
  );
  const artifactDir =
    options.artifactDir ??
    (phase === "judge-only" ? undefined : createArtifactDir(options.artifactBaseDir ?? defaultRunsDir));

  let pendingGrades: PairGradeItem[] = [];
  let pairs: EvalPairRecord[] = [];

  if (phase === "judge-only") {
    const sourcePath = options.judgeFromPath;
    if (!sourcePath) {
      throw new Error("judge-only phase requires judgeFromPath");
    }
    const saved = readPairsJsonl(sourcePath);
    pendingGrades = saved.map((record) => {
      const caseDef = caseById.get(record.caseId);
      if (!caseDef) {
        throw new Error(`Case ${record.caseId} not in suite ${options.suitePath}`);
      }
      return {
        caseId: record.caseId,
        caseDef,
        baseline: record.baseline,
        candidate: record.candidate,
      };
    });
  } else if (artifactDir) {
    pendingGrades = await _runAgentPairs(options, cases, repetitions, artifactDir, budget);
    if (phase === "agent-only") {
      pairs = _agentOnlyPairs(pendingGrades);
    }
  }

  if (phase !== "agent-only") {
    const judgeBatch = options.judgeBatchSize ?? 8;
    evalLog(`judge start pairs=${pendingGrades.length} batch=${judgeBatch}`);
    const judgeStart = Date.now();
    const graded = await gradePairBatch(pendingGrades, {
      judgeModel,
      batchSize: judgeBatch,
      onJudgeUsage: (usage, model) => {
        budget?.recordJudgeUsage(usage, model);
        if (budget?.exceedsLimit()) {
          throw new EvalBudgetExceededError(budget.summary());
        }
      },
    });
    evalVerbose(options.verbose ?? false, `judge done wall=${Date.now() - judgeStart}ms`);
    evalLog(`judge done pairs=${pendingGrades.length}`);
    pairs = await _pairsFromPendingEnriched(pendingGrades, graded, phase);
  }

  const compare = summarizeComparison(
    options.baseline.name,
    options.candidate.name,
    pairs.filter((pair) => pair.verdict.rationale !== AGENT_ONLY_VERDICT.rationale),
  );

  let baselineDelta: EvalReport["baselineDelta"];
  if (compare && options.baselineFromPath) {
    const baseline = loadBaseline(options.baselineFromPath);
    if (baseline?.compare) {
      baselineDelta = compareToBaseline(compare, baseline.compare);
    }
  }

  const finishedAt = new Date().toISOString();
  const budgetSummary = budget?.summary();
  const intervention = options.intervention ?? { mode: "toggle" as const, headSha: gitSha() };
  const runManifest = buildEvalRunManifest({
    suiteVersion: suite.version,
    suitePath: options.suitePath,
    cases,
    repetitions,
    gitSha: gitSha(),
    intervention,
    baseline: options.baseline,
    candidate: options.candidate,
    comparable: comparability.comparable,
    comparabilityReason: comparability.reason,
    budget: budgetSummary,
    startedAt,
    finishedAt,
  });

  const report: EvalReport = {
    suiteVersion: suite.version,
    gitSha: gitSha(),
    model: agentModel,
    provider: runManifest.baseline.route.providerPresetId,
    artifactDir,
    pairs,
    compare: pairs.some((p) => p.phase !== "agent-only") ? compare : undefined,
    baselineDelta,
    manifest: runManifest,
    budget: budgetSummary,
    comparable: comparability.comparable,
    comparabilityReason: comparability.reason,
  };

  if (artifactDir) {
    writeEvalReport(artifactDir, report);
    evalLog(`phase=${phase} artifacts=${artifactDir}`);
  }

  if (options.writeBaselinePath && report.compare) {
    writeBaseline(report.compare, {
      suiteVersion: report.suiteVersion,
      gitSha: report.gitSha,
    }, options.writeBaselinePath);
    evalLog(`baseline written to ${options.writeBaselinePath}`);
  }

  if (report.compare) {
    process.stderr.write(`${formatCompareSummary(report.compare)}\n`);
    if (baselineDelta) {
      evalLog(
        `baseline delta: meanScore ${baselineDelta.meanScoreDelta >= 0 ? "+" : ""}${baselineDelta.meanScoreDelta.toFixed(2)} ` +
          `winRate ${baselineDelta.winRateDeltaPct >= 0 ? "+" : ""}${baselineDelta.winRateDeltaPct.toFixed(1)}%`,
      );
    }
  }

  const mergeGateFailed = Boolean(
    options.mergeGate &&
      comparability.comparable &&
      report.compare &&
      shouldFailMergeGate(report.compare),
  );

  if (options.mergeGate && !comparability.comparable) {
    evalLog(`merge-gate skipped: ${comparability.reason}`);
  }

  return { report, mergeGateFailed };
}

export { createMoonTideEvalHarness };
