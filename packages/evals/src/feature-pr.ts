import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BASELINE_PATH } from "./baseline.js";
import {
  resolveEvalIntervention,
  type EvalInterventionMode,
} from "./intervention.js";
import { FEATURE_PR_HELP, printFeatureSurfaces } from "./feature-pr-help.js";
import {
  formatFeaturePrImpactMarkdown,
  mergeGateReasons,
  writeFeaturePrImpactSnippet,
  type FeaturePrStepReport,
} from "./feature-pr-impact.js";
import {
  FEATURE_PR_GUARD_SUITE,
  featurePrPrimaryPlan,
  listFeatureSurfaces,
} from "./feature-pr-plan.js";
import { parseEvalCliArgs } from "./cli-args.js";
import { createMoonTideEvalHarness } from "./moontide-harness.js";
import { evalLog } from "./progress-log.js";
import { EvalBudgetExceededError, runSuiteAbWithGate } from "./runner.js";
import { formatCompareSummary } from "./summary.js";
import type { FeatureSurface } from "./types.js";
import type { RunSuiteAbResult } from "./runner.js";

export interface FeaturePrStep {
  label: "guard" | "primary";
  suitePath: string;
  featureSurface?: FeatureSurface;
}

export interface FeaturePrOptions {
  featureSurface: FeatureSurface;
  repetitions: number;
  agentConcurrency: number;
  mergeGate: boolean;
  baselineFromPath?: string;
  writeBaselinePath?: string;
  verbose: boolean;
  logPath?: string;
  writeImpact: boolean;
  interventionMode?: EvalInterventionMode;
  budgetMicroCny?: number;
  maxCases?: number;
  harness: ReturnType<typeof parseEvalCliArgs>["harness"];
}

export interface FeaturePrStepResult {
  step: FeaturePrStep;
  result: RunSuiteAbResult;
}

export function featurePrSteps(featureSurface: FeatureSurface): FeaturePrStep[] {
  const primary = featurePrPrimaryPlan(featureSurface);
  return [
    { label: "guard", suitePath: FEATURE_PR_GUARD_SUITE },
    {
      label: "primary",
      suitePath: primary.suitePath,
      featureSurface: primary.featureSurface,
    },
  ];
}

function _argValue(args: string[], prefix: string): string | undefined {
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function _flag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function parseFeaturePrArgs(argv: string[]): FeaturePrOptions | "help" | "list-surfaces" {
  if (_flag(argv, "--help") || _flag(argv, "-h")) {
    return "help";
  }
  if (_flag(argv, "--list-surfaces")) {
    return "list-surfaces";
  }

  const featureSurface = _argValue(argv, "--feature-surface=") as FeatureSurface | undefined;
  if (!featureSurface) {
    throw new Error("--feature-surface=<name> is required (try --list-surfaces or --help)");
  }
  if (!listFeatureSurfaces().includes(featureSurface)) {
    throw new Error(`Unknown feature surface: ${featureSurface} (try --list-surfaces)`);
  }

  const shared = parseEvalCliArgs(["v2/regression", ...argv.filter((a) => !a.startsWith("--feature-surface="))]);

  const repetitionsRaw = _argValue(argv, "--repetitions=");
  const repetitions = repetitionsRaw ? Number(repetitionsRaw) : 1;

  const writeImpact = !_flag(argv, "--no-write-impact");

  return {
    featureSurface,
    repetitions: Number.isFinite(repetitions) ? repetitions : 1,
    agentConcurrency: shared.agentConcurrency,
    mergeGate: !_flag(argv, "--no-merge-gate"),
    baselineFromPath: _argValue(argv, "--baseline-from=") ?? DEFAULT_BASELINE_PATH,
    writeBaselinePath: _flag(argv, "--write-baseline")
      ? _argValue(argv, "--write-baseline=") ?? DEFAULT_BASELINE_PATH
      : undefined,
    verbose: shared.verbose || _flag(argv, "--verbose"),
    logPath: _argValue(argv, "--log="),
    writeImpact,
    interventionMode: shared.interventionMode,
    budgetMicroCny: shared.budgetMicroCny,
    maxCases: shared.maxCases,
    harness: shared.harness,
  };
}

export { FEATURE_PR_HELP, printFeatureSurfaces };

function _defaultLogPath(featureSurface: FeatureSurface): string {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(packageRoot, "runs", `feature-pr_${featureSurface}_${stamp}.log`);
}

function _installLogTee(logPath?: string): () => void {
  if (!logPath) {
    return () => {};
  }
  const resolved = path.resolve(logPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const stream = fs.createWriteStream(resolved, { flags: "a" });
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => {
    if (typeof chunk === "string") {
      stream.write(chunk);
    } else {
      stream.write(chunk);
    }
    if (typeof encodingOrCb === "function") {
      return origWrite(chunk, encodingOrCb);
    }
    return origWrite(chunk, encodingOrCb, cb);
  }) as typeof process.stderr.write;
  evalLog(`logging to ${resolved}`);
  return () => {
    stream.end();
    process.stderr.write = origWrite;
  };
}

export async function runFeaturePrEval(options: FeaturePrOptions): Promise<boolean> {
  const intervention = resolveEvalIntervention({
    mode: options.interventionMode,
    baseline: options.harness.baseline,
    candidate: options.harness.candidate,
  });

  evalLog(`intervention mode=${intervention.mode}`);

  const logPath = options.logPath ?? _defaultLogPath(options.featureSurface);
  const teardown = _installLogTee(logPath);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const artifactBaseDir = path.join(packageRoot, "runs");
  const baseline = createMoonTideEvalHarness(options.harness.baseline);
  const candidate = createMoonTideEvalHarness(options.harness.candidate);
  const steps = featurePrSteps(options.featureSurface);
  const primaryPlan = featurePrPrimaryPlan(options.featureSurface);

  evalLog(
    `feature-pr surface=${options.featureSurface} primary=${primaryPlan.suitePath} ` +
      `repetitions=${options.repetitions} concurrency=${options.agentConcurrency} mergeGate=${options.mergeGate}`,
  );

  const stepResults: FeaturePrStepResult[] = [];
  let mergeGateFailed = false;

  try {
    for (const step of steps) {
      evalLog(`step ${step.label} suite=${step.suitePath}${step.featureSurface ? ` filter=${step.featureSurface}` : ""}`);
      const result = await runSuiteAbWithGate({
        suitePath: step.suitePath,
        baseline,
        candidate,
        repetitions: options.repetitions,
        featureSurface: step.featureSurface,
        agentConcurrency: options.agentConcurrency,
        mergeGate: options.mergeGate,
        baselineFromPath: options.baselineFromPath,
        writeBaselinePath: options.writeBaselinePath,
        artifactBaseDir,
        verbose: options.verbose,
        intervention,
        budgetMicroCny: options.budgetMicroCny,
        maxCases: options.maxCases,
      });
      stepResults.push({ step, result });
      mergeGateFailed ||= result.mergeGateFailed;
    }
  } catch (err) {
    if (err instanceof EvalBudgetExceededError) {
      evalLog(err.message);
      throw err;
    }
    throw err;
  } finally {
    teardown();
  }

  _printFeaturePrSummary(options, stepResults, mergeGateFailed, logPath);
  return mergeGateFailed;
}

function _printFeaturePrSummary(
  options: FeaturePrOptions,
  stepResults: FeaturePrStepResult[],
  mergeGateFailed: boolean,
  logPath: string,
): void {
  const stepReports: FeaturePrStepReport[] = stepResults.map(({ step, result }) => ({
    step,
    report: result.report,
  }));

  evalLog("feature-pr summary");
  for (const { step, result } of stepResults) {
    const compare = result.report.compare;
    const artifact = result.report.artifactDir
      ? path.basename(result.report.artifactDir)
      : "n/a";
    if (!compare) {
      evalLog(`  ${step.label}: no compare artifacts=${artifact}`);
      continue;
    }
    evalLog(
      `  ${step.label}: meanScore=${compare.meanScore.toFixed(2)} winRate=${compare.winRatePct.toFixed(1)}% ` +
        `regressions=${compare.regressionAlerts.length} lift=${compare.liftAlerts.length} artifacts=${artifact}`,
    );
  }

  const primary = stepResults.find((entry) => entry.step.label === "primary")?.result.report.compare;
  if (primary) {
    process.stdout.write(`\n${formatCompareSummary(primary)}\n`);
  }

  if (options.writeImpact) {
    const snippetPath = writeFeaturePrImpactSnippet(
      options.featureSurface,
      stepReports,
      mergeGateFailed,
    );
    if (snippetPath) {
      evalLog(`impact snippet: ${snippetPath}`);
      process.stdout.write(`\n${formatFeaturePrImpactMarkdown(options.featureSurface, stepReports, mergeGateFailed)}\n`);
    }
  }

  const reasons = mergeGateReasons(stepReports);
  if (reasons.length > 0) {
    evalLog(`merge-gate reasons: ${reasons.join("; ")}`);
  }
  evalLog(`log: ${path.resolve(logPath)}`);
  evalLog(`feature-pr mergeGate=${mergeGateFailed ? "FAIL" : "PASS"}`);
}
