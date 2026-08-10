import readline from "node:readline";

import "../../../apps/moontide/src/bootstrap.js";
import { setupToolsPorts } from "../../../apps/moontide/src/agent/tools-setup.js";
import { registerBuiltinWorkMemPorts } from "../../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import "../../../apps/moontide/src/tools/register-defaults.js";

setupToolsPorts();
registerBuiltinWorkMemPorts();

import type { AgentJobPayload, AgentJobResult } from "../src/agent-worker.js";
import { runEvalCasePair } from "../src/moontide-harness.js";

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines: string[] = [];

  for await (const line of rl) {
    if (line.trim().length > 0) {
      lines.push(line);
    }
  }

  const raw = lines.join("\n").trim();
  if (!raw) {
    process.stderr.write("agent job: empty stdin\n");
    process.exitCode = 1;
    return;
  }

  let payload: AgentJobPayload;
  try {
    payload = JSON.parse(raw) as AgentJobPayload;
  } catch (err) {
    process.stderr.write(
      `agent job: invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const result: AgentJobResult = await runEvalCasePair(payload);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
