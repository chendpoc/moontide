import path from "node:path";
import { fileURLToPath } from "node:url";

import "../../../apps/moontide/src/bootstrap.js";
import { setupToolsPorts } from "../../../apps/moontide/src/agent/tools-setup.js";
import { registerBuiltinWorkMemPorts } from "../../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import "../../../apps/moontide/src/tools/register-defaults.js";

setupToolsPorts();
registerBuiltinWorkMemPorts();

import { EVAL_EXIT_BUDGET_EXCEEDED } from "../src/budget.js";
import { parseEvalCliArgs } from "../src/cli-args.js";
import {
  EvalInterventionError,
  EVAL_EXIT_INTERVENTION_INVALID,
  resolveEvalIntervention,
} from "../src/intervention.js";
import {
  createMoonTideEvalHarness,
  EvalBudgetExceededError,
  formatCompareSummary,
  hasEvalApiKey,
  runSuiteAbWithGate,
} from "../src/index.js";

async function main(): Promise<void> {
  let cli;
  try {
    cli = parseEvalCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
    return;
  }

  const needsJudge = cli.phase !== "agent-only";
  if (needsJudge && !hasEvalApiKey()) {
    process.stderr.write(
      "[eval] Set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY in .env before running judge.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (cli.phase === "agent-only" && !hasEvalApiKey()) {
    process.stderr.write(
      "[eval] Set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY for agent runs.\n",
    );
    process.exitCode = 1;
    return;
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const artifactBaseDir = path.join(packageRoot, "runs");

  const baseline = createMoonTideEvalHarness(cli.harness.baseline);
  const candidate = createMoonTideEvalHarness(cli.harness.candidate);

  let intervention;
  try {
    intervention = resolveEvalIntervention({
      mode: cli.interventionMode,
      baseline: cli.harness.baseline,
      candidate: cli.harness.candidate,
    });
  } catch (err) {
    if (err instanceof EvalInterventionError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = EVAL_EXIT_INTERVENTION_INVALID;
      return;
    }
    throw err;
  }

  let mergeGateFailed = false;
  let lastSummary: string | undefined;

  try {
    for (const suitePath of cli.suitePaths) {
      process.stderr.write(`[eval] suite=${suitePath}\n`);
      const { report, mergeGateFailed: failed } = await runSuiteAbWithGate({
        suitePath,
        baseline,
        candidate,
        repetitions: cli.repetitions,
        caseId: cli.caseId,
        caseFilter: cli.caseFilter,
        featureSurface: cli.featureSurface,
        judgeBatchSize: cli.judgeBatchSize,
        agentConcurrency: cli.agentConcurrency,
        phase: cli.phase,
        judgeFromPath: cli.judgeFromPath,
        artifactBaseDir,
        recordHttpFixtures: cli.recordHttpFixtures,
        baselineFromPath: cli.baselineFromPath,
        writeBaselinePath: cli.writeBaselinePath,
        mergeGate: cli.mergeGate,
        verbose: cli.verbose,
        intervention,
        budgetMicroCny: cli.budgetMicroCny,
        maxCases: cli.maxCases,
      });
      mergeGateFailed ||= failed;
      if (report.compare) {
        lastSummary = formatCompareSummary(report.compare);
      }
    }
  } catch (err) {
    if (err instanceof EvalBudgetExceededError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = EVAL_EXIT_BUDGET_EXCEEDED;
      return;
    }
    throw err;
  }

  if (lastSummary) {
    process.stdout.write(`${lastSummary}\n`);
  }

  if (mergeGateFailed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
