import "../../../apps/moontide/src/bootstrap.js";
import { setupToolsPorts } from "../../../apps/moontide/src/agent/tools-setup.js";
import { registerBuiltinWorkMemPorts } from "../../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import "../../../apps/moontide/src/tools/register-defaults.js";

setupToolsPorts();
registerBuiltinWorkMemPorts();

import { hasEvalApiKey } from "../src/env.js";
import { EvalInterventionError, EVAL_EXIT_INTERVENTION_INVALID } from "../src/intervention.js";
import { EVAL_EXIT_BUDGET_EXCEEDED } from "../src/budget.js";
import {
  FEATURE_PR_HELP,
  parseFeaturePrArgs,
  printFeatureSurfaces,
  runFeaturePrEval,
} from "../src/feature-pr.js";
import { EvalBudgetExceededError } from "../src/runner.js";
import { evalLog } from "../src/progress-log.js";

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseFeaturePrArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(`\n${FEATURE_PR_HELP}\n`);
    process.exitCode = 1;
    return;
  }

  if (parsed === "help") {
    process.stdout.write(`${FEATURE_PR_HELP}\n`);
    return;
  }

  if (parsed === "list-surfaces") {
    printFeatureSurfaces();
    return;
  }

  if (!hasEvalApiKey()) {
    process.stderr.write(
      "[eval] Set DEEPSEEK_API_KEY in .env before running feature-pr.\n",
    );
    process.exitCode = 1;
    return;
  }

  const mergeGateFailed = await runFeaturePrEval(parsed);
  if (mergeGateFailed) {
    process.exitCode = 1;
    evalLog("exit 1 (merge-gate failed)");
  }
}

main().catch((err) => {
  if (err instanceof EvalInterventionError) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = EVAL_EXIT_INTERVENTION_INVALID;
    return;
  }
  if (err instanceof EvalBudgetExceededError) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = EVAL_EXIT_BUDGET_EXCEEDED;
    return;
  }
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
