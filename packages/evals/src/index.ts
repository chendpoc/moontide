export { createArtifactDir, gitSha, readPairsJsonl, writeEvalReport } from "./artifacts.js";
export { compareToBaseline, loadBaseline, shouldFailMergeGate, writeBaseline, DEFAULT_BASELINE_PATH, MERGE_GATE_MIN_MEAN_SCORE } from "./baseline.js";
export { spawnAgentJob } from "./agent-worker.js";
export type { AgentJobPayload, AgentJobResult } from "./agent-worker.js";
export {
  parseEvalCliArgs,
  resolveAgentConcurrency,
  resolveJudgeBatchSize,
  selectSuiteCases,
} from "./cli-args.js";
export type { ParsedEvalCliArgs } from "./cli-args.js";
/** @deprecated Use programmatic harness config in runSuiteAb options. */
export { evalHarnessTable } from "./harness-table.js";
export type { EvalHarnessTableInput } from "./harness-table.js";
export {
  gradePair,
  gradePairBatch,
  parsePairwiseVerdict,
  parsePairwiseVerdictText,
  runChecksOnOutput,
} from "./graders/index.js";
export type { GradePairResult, LlmJudgeOptions } from "./graders/index.js";
export { runProtocolChecks } from "./graders/protocol-checks.js";
export { runEfficiencyChecks, efficiencyFromOutput } from "./graders/efficiency-checks.js";
export { createMoonTideEvalHarness, runEvalCase, runEvalCasePair } from "./moontide-harness.js";
export { runSuiteAb, runSuiteAbWithGate } from "./runner.js";
export type { RunSuiteOptions, RunSuiteAbResult } from "./runner.js";
export { loadSuite, listSuiteFiles, suitePath } from "./suite-loader.js";
export { formatCompareSummary, summarizeComparison } from "./summary.js";
export { hasEvalApiKey } from "./env.js";
export { withRetry, isRateLimitError } from "./retry.js";
export { loadHttpRecordings, installEvalHttpFixtures, clearEvalHttpFixtures } from "./http-fixtures.js";
export type {
  BaselineDelta,
  BaselineSnapshot,
  CompareSummary,
  EfficiencyMetrics,
  EfficiencySummary,
  EvalBucket,
  EvalCaseCategory,
  EvalCaseDefinition,
  EvalGradingMode,
  EvalPairRecord,
  EvalReport,
  EvalRunOutput,
  EvalRunPhase,
  EvalStep,
  EvalSuiteFile,
  ExpectedCheck,
  FeatureSurface,
  HarnessConfigFile,
  HarnessTableRow,
  JudgeMode,
  MoonTideEvalHarnessConfig,
  PairGradeItem,
  PairwiseJudgeVerdict,
  ProtocolCheckOutcome,
  RubricJudgeOutcome,
} from "./types.js";
