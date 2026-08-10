import path from "node:path";
import { fileURLToPath } from "node:url";

import { modelId } from "../../../apps/moontide/src/config.js";
import { compareToBaseline, loadBaseline, writeBaseline } from "./baseline.js";
import { AGENT_ONLY_VERDICT, selectSuiteCases } from "./cli-args.js";
import { runConcurrent } from "./concurrency.js";
import { gradePairBatch } from "./graders/index.js";
import { runProtocolChecks } from "./graders/protocol-checks.js";
import { gradeWithRubric } from "./graders/rubric-judge.js";
import { spawnAgentJob } from "./agent-worker.js";
import { createArtifactDir, gitSha, readPairsJsonl, writeEvalReport } from "./artifacts.js";
import { createMoonTideEvalHarness } from "./moontide-harness.js";
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
}

async function _runAgentPairs(
  options: RunSuiteOptions,
  cases: ReturnType<typeof loadSuite>["cases"],
  repetitions: number,
  artifactDir: string,
): Promise<PairGradeItem[]> {
  const jobs: Array<() => Promise<PairGradeItem>> = [];

  for (const caseDef of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const rep = repetition;
      jobs.push(async () =>
        spawnAgentJob({
          baseline: options.baseline,
          candidate: options.candidate,
          caseDef,
          repetition: rep,
          artifactDir,
          recordHttpFixtures: options.recordHttpFixtures,
        }),
      );
    }
  }

  const concurrency = options.agentConcurrency ?? 4;
  process.stderr.write(
    `[eval] agent jobs=${jobs.length} concurrency=${concurrency} (subprocess)\n`,
  );
  return runConcurrent(jobs, concurrency);
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
  const suite = loadSuite(options.suitePath);
  const repetitions = options.repetitions ?? 1;
  const phase = options.phase ?? "full";
  const suiteLabel = suitePath(options.suitePath);
  const cases = selectSuiteCases(
    suite.cases,
    {
      caseId: options.caseId,
      caseFilter: options.caseFilter,
      featureSurface: options.featureSurface,
    },
    suiteLabel,
  );
  const caseById = _caseDefById(suite.cases);

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
    pendingGrades = await _runAgentPairs(options, cases, repetitions, artifactDir);
    if (phase === "agent-only") {
      pairs = _agentOnlyPairs(pendingGrades);
    }
  }

  if (phase !== "agent-only") {
    const judgeModel = options.baseline.judgeModel ?? options.candidate.judgeModel;
    const graded = await gradePairBatch(pendingGrades, {
      judgeModel,
      batchSize: options.judgeBatchSize,
    });
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

  const report: EvalReport = {
    suiteVersion: suite.version,
    gitSha: gitSha(),
    model: process.env.MOONTIDE_MODEL ?? process.env.MOONTIDE_MODEL_ID ?? modelId(),
    provider: process.env.MOONTIDE_PROVIDER,
    artifactDir,
    pairs,
    compare: pairs.some((p) => p.phase !== "agent-only") ? compare : undefined,
    baselineDelta,
  };

  if (artifactDir) {
    writeEvalReport(artifactDir, report);
    process.stderr.write(`[eval] phase=${phase} artifacts=${artifactDir}\n`);
  }

  if (options.writeBaselinePath && report.compare) {
    writeBaseline(report.compare, {
      suiteVersion: report.suiteVersion,
      gitSha: report.gitSha,
    }, options.writeBaselinePath);
    process.stderr.write(`[eval] baseline written to ${options.writeBaselinePath}\n`);
  }

  if (report.compare) {
    process.stderr.write(`${formatCompareSummary(report.compare)}\n`);
    if (baselineDelta) {
      process.stderr.write(
        `[eval] baseline delta: meanScore ${baselineDelta.meanScoreDelta >= 0 ? "+" : ""}${baselineDelta.meanScoreDelta.toFixed(2)} winRate ${baselineDelta.winRateDeltaPct >= 0 ? "+" : ""}${baselineDelta.winRateDeltaPct.toFixed(1)}%\n`,
      );
    }
  }

  const mergeGateFailed =
    Boolean(options.mergeGate && report.compare && (
      report.compare.meanScore < 3.5 ||
      report.compare.regressionAlerts.length > 0 ||
      report.compare.liftAlerts.length > 0
    ));

  return { report, mergeGateFailed };
}

export { createMoonTideEvalHarness };
