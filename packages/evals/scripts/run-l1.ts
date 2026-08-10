import "../../../apps/moontide/src/bootstrap.js";
import { setupToolsPorts } from "../../../apps/moontide/src/agent/tools-setup.js";
import { registerBuiltinWorkMemPorts } from "../../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import "../../../apps/moontide/src/tools/register-defaults.js";

setupToolsPorts();
registerBuiltinWorkMemPorts();

import { runL1Eval } from "../src/l1-runner.js";
import type { FeatureSurface } from "../src/types.js";

function _argValue(args: string[], prefix: string): string | undefined {
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const maxCasesRaw = _argValue(argv, "--max-cases=");
  const maxCases = maxCasesRaw ? Number(maxCasesRaw) : undefined;
  const suitePath = argv.find((arg) => !arg.startsWith("-")) ?? "v2/regression";
  const featureSurface = _argValue(argv, "--feature-surface=") as FeatureSurface | undefined;

  process.stderr.write(`[eval:l1] suite=${suitePath} mock LLM agent-only\n`);

  const result = await runL1Eval({
    suitePath,
    featureSurface,
    maxCases: maxCases && Number.isFinite(maxCases) ? maxCases : 5,
  });

  if (result.protocolNotes.length > 0) {
    process.stderr.write("[eval:l1] protocol notes (mock runs may not satisfy deep protocol):\n");
    for (const line of result.protocolNotes.slice(0, 10)) {
      process.stderr.write(`  ${line}\n`);
    }
  }

  if (result.agentErrors.length > 0) {
    process.stderr.write("[eval:l1] agent errors:\n");
    for (const line of result.agentErrors) {
      process.stderr.write(`  ${line}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
