export {
  EvalInterventionError,
  EVAL_EXIT_INTERVENTION_INVALID,
  resolveEvalIntervention,
  validateEvalIntervention,
  harnessAbDiffFields,
  hasToggleIntervention,
} from "./intervention.js";
export type { EvalInterventionMode, ResolvedEvalIntervention } from "./intervention.js";
export { BudgetLedger, EVAL_EXIT_BUDGET_EXCEEDED, usageCostMicroCny } from "./budget.js";
export type { BudgetSummary, TokenUsage } from "./budget.js";
export { checkArmsComparable } from "./comparability.js";
export {
  DEFAULT_EVAL_AGENT_MODEL,
  DEFAULT_EVAL_JUDGE_MODEL,
  normalizeHarnessConfig,
  applyHarnessRuntimeEnv,
} from "./harness-env.js";
export { buildEvalRunManifest, suiteContentHash } from "./manifest.js";
export type { EvalArmManifest, EvalRouteManifest, EvalRunManifest } from "./manifest-types.js";
export { createArtifactDir, gitSha, readPairsJsonl, writeEvalReport } from "./artifacts.js";
export { compareToBaseline, loadBaseline, shouldFailMergeGate, writeBaseline, DEFAULT_BASELINE_PATH, MERGE_GATE_MIN_MEAN_SCORE } from "./baseline.js";
export { parseFeaturePrArgs, runFeaturePrEval, featurePrSteps, FEATURE_PR_HELP, printFeatureSurfaces } from "./feature-pr.js";
export type { FeaturePrOptions, FeaturePrStep, FeaturePrStepResult } from "./feature-pr.js";
export {
  FEATURE_PR_GUARD_SUITE,
  FEATURE_PR_PRIMARY_PLAN,
  featurePrPrimaryPlan,
  listFeatureSurfaces,
} from "./feature-pr-plan.js";
export type { FeaturePrPrimaryPlan } from "./feature-pr-plan.js";
export {
  formatFeaturePrImpactMarkdown,
  mergeGateReasons,
  writeFeaturePrImpactSnippet,
} from "./feature-pr-impact.js";
export type { FeaturePrImpactStep, FeaturePrStepReport } from "./feature-pr-impact.js";
export { evalLog, evalVerbose, formatAgentJobSummary } from "./progress-log.js";
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
export { runSuiteAb, runSuiteAbWithGate, EvalBudgetExceededError } from "./runner.js";
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
