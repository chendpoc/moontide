import type { SessionItem } from "@moontide/session";
import type { WorkMemEvent } from "@moontide/tools";

export type EvalBucket = "A" | "B" | "C" | "D" | "E";

export type EvalCaseCategory =
  | "coding"
  | "deep_task"
  | "general"
  | "regression"
  | "exploration"
  | "external_research";

export type EvalGradingMode = "objective" | "subjective";

export type EvalRunPhase = "full" | "agent-only" | "judge-only";

export type JudgeMode = "single" | "batch";

export type EvalStep =
  | { type: "prompt"; content: string }
  | { type: "reload" };

export type FeatureSurface =
  | "tooling"
  | "prompt"
  | "context"
  | "deep_protocol"
  | "model_only";

export const FEATURE_SURFACES: readonly FeatureSurface[] = [
  "tooling",
  "prompt",
  "context",
  "deep_protocol",
  "model_only",
] as const;

export type ExpectedCheck =
  | { kind: "reply_contains"; value: string }
  | { kind: "reply_matches"; pattern: string }
  | { kind: "file_contains"; path: string; value: string }
  | { kind: "tool_min_count"; min: number }
  | { kind: "tool_called"; name: string }
  | { kind: "work_mem_used" };

export const EVAL_CASE_CATEGORIES: readonly EvalCaseCategory[] = [
  "coding",
  "deep_task",
  "general",
  "regression",
  "exploration",
  "external_research",
] as const;

export interface EvalCaseDefinition {
  id: string;
  category: EvalCaseCategory;
  gradingMode: EvalGradingMode;
  /** Harness surfaces this case is meant to stress (for merge subset selection). */
  featureSurface?: FeatureSurface[];
  expectLift?: boolean;
  steps: EvalStep[];
  setup?: {
    files?: Record<string, string>;
  };
  /** Relative path under category dir to http/recordings.json (external_research). */
  httpFixturesPath?: string;
  expectedChecks?: ExpectedCheck[];
  judgeModel?: string;
  rubricBullets?: string[];
}

export interface EvalSuiteFile {
  version: string;
  bucket?: EvalBucket;
  cases: EvalCaseDefinition[];
}

export interface MoonTideEvalHarnessConfig {
  name: string;
  disableProtocolReminders?: boolean;
  model?: string;
  judgeModel?: string;
}

export interface EvalRunOutput {
  harnessName: string;
  caseId: string;
  repetition: number;
  sessionId: string;
  runId?: string;
  reply: string;
  turn: number;
  items: SessionItem[];
  workMemId?: string;
  workMemEvents?: WorkMemEvent[];
  /** Relative path → file content captured before workdir teardown. */
  files?: Record<string, string>;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  error?: string;
  infraError?: boolean;
}

export type PairwiseScore = 1 | 2 | 3 | 4 | 5;

export type PairwiseWinner = "baseline" | "candidate" | "tie";

export interface PairwiseJudgeVerdict {
  score: PairwiseScore;
  winner: PairwiseWinner;
  rationale: string;
  baselineGood?: string[];
  baselineBad?: string[];
  candidateGood?: string[];
  candidateBad?: string[];
}

export interface ObjectiveCheckOutcome {
  passCount: number;
  totalChecks: number;
  allPass: boolean;
  details: string[];
}

export interface ProtocolCheckOutcome {
  workMemUsed: boolean;
  outlineBeforeTools: boolean;
  decisionRecorded: boolean;
  synthesizeReminderFired: boolean;
  details: string[];
}

export interface EfficiencyMetrics {
  turnCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface RubricJudgeOutcome {
  score: number;
  pass: boolean;
  rationale: string;
  missedBullets: string[];
}

export interface EvalPairRecord {
  caseId: string;
  category: EvalCaseCategory;
  gradingMode: EvalGradingMode;
  featureSurface?: FeatureSurface[];
  expectLift?: boolean;
  repetition: number;
  baseline: EvalRunOutput;
  candidate: EvalRunOutput;
  verdict: PairwiseJudgeVerdict;
  objectiveChecks?: {
    baseline: ObjectiveCheckOutcome;
    candidate: ObjectiveCheckOutcome;
  };
  protocolChecks?: {
    baseline: ProtocolCheckOutcome;
    candidate: ProtocolCheckOutcome;
  };
  rubricChecks?: {
    baseline: RubricJudgeOutcome;
    candidate: RubricJudgeOutcome;
  };
  judgeModel?: string;
  phase?: "full" | "agent-only" | "judge-only";
}

export interface HarnessTableRow {
  name: string;
  harness: MoonTideEvalHarnessConfig;
  repetition: number;
}

export interface CategorySummary {
  meanScore: number;
  count: number;
  winRatePct: number;
}

export interface EfficiencySummary {
  meanDurationMs: number;
  meanToolCalls: number;
  meanInputTokens: number;
  meanOutputTokens: number;
}

export interface CompareSummary {
  baselineName: string;
  candidateName: string;
  pairedCount: number;
  incompletePairs: number;
  meanScore: number;
  winRatePct: number;
  improvedRatePct: number;
  byCategory: Partial<Record<EvalCaseCategory, CategorySummary>>;
  byGradingMode: Partial<Record<EvalGradingMode, CategorySummary>>;
  byFeatureSurface: Partial<Record<FeatureSurface, CategorySummary>>;
  efficiency: EfficiencySummary;
  regressionAlerts: string[];
  liftAlerts: string[];
  infraFailures: string[];
}

export interface BaselineDelta {
  meanScoreDelta: number;
  winRateDeltaPct: number;
  byCategoryDelta: Partial<Record<EvalCaseCategory, { meanScoreDelta: number }>>;
}

export interface BaselineSnapshot {
  suiteVersion: string;
  gitSha: string;
  recordedAt: string;
  compare: CompareSummary;
}

export interface EvalReport {
  suiteVersion: string;
  gitSha: string;
  model?: string;
  provider?: string;
  artifactDir?: string;
  pairs: EvalPairRecord[];
  compare?: CompareSummary;
  baselineDelta?: BaselineDelta;
}

export interface PairGradeItem {
  caseId: string;
  caseDef: EvalCaseDefinition;
  baseline: EvalRunOutput;
  candidate: EvalRunOutput;
}

export interface JudgeOptions {
  judgeModel?: string;
  batchSize?: number;
}

export interface HarnessConfigFile {
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
}
