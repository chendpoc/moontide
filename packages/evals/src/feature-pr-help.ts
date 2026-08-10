import { DEFAULT_BASELINE_PATH } from "./baseline.js";
import { FEATURE_PR_GUARD_SUITE, FEATURE_PR_PRIMARY_PLAN, listFeatureSurfaces } from "./feature-pr-plan.js";

export const FEATURE_PR_HELP = `Usage: pnpm eval:feature -- --feature-surface=<surface> [options]

PR eval orchestration: regression guard → primary suite → merge-gate summary.

Required:
  --feature-surface=<name>   Feature under test (see --list-surfaces)

Options:
  --intervention=toggle          Harness toggle A/B (auto when baseline/candidate differ)
  --agent-model=<id>               Agent model (default: deepseek-v4-flash)
  --judge-model=<id>               Judge model (default: deepseek-v4-flash)
  --budget-micro-cny=N             Soft API budget in micro-CNY (exit 2 when exceeded)
  --max-cases=N                    Cap cases per suite (cost control)
  --agent-concurrency=N      Parallel agent jobs (1–10, default 4)
  --repetitions=N            Repetitions per case (default 1)
  --baseline-from=<path>     Compare delta (default: packages/evals/baseline.json)
  --write-baseline[=path]    Update baseline after run
  --verbose                  Forward subprocess stderr
  --log=<path>               Tee stderr to log file
  --no-merge-gate            Report only; exit 0 even if metrics fail
  --write-impact             Write impact-snippet.md to primary artifact dir (default on)
  --no-write-impact          Skip impact-snippet.md
  --list-surfaces            Print feature surface → suite map
  --help                     Show this help

Harness (baseline vs candidate):
  --baseline-name=<name>     Default: baseline
  --candidate-name=<name>    Default: with-feature
  --baseline-disable-protocol-reminders   (default for baseline)
  --candidate-disable-protocol-reminders
  --harness-config=<json>    Full harness JSON file

Examples:
  pnpm eval:feature -- --feature-surface=deep_protocol
  pnpm eval:feature -- --feature-surface=tooling --agent-concurrency=6 --verbose
  pnpm eval:summarize

Debug (escape hatch, not PR default):
  pnpm eval -- v2/deep_task --case-id=<id> --agent-only --verbose
`;

export function printFeatureSurfaces(): void {
  process.stdout.write("Feature surfaces (guard suite: v2/regression for all):\n\n");
  for (const surface of listFeatureSurfaces()) {
    const plan = FEATURE_PR_PRIMARY_PLAN[surface];
    process.stdout.write(
      `  ${surface.padEnd(14)} primary=${plan.suitePath}` +
        (plan.featureSurface ? ` filter=${plan.featureSurface}` : "") +
        `  # ${plan.description}\n`,
    );
  }
  process.stdout.write(`\nbaseline default: ${DEFAULT_BASELINE_PATH}\n`);
  process.stdout.write(`guard suite: ${FEATURE_PR_GUARD_SUITE}\n`);
}
