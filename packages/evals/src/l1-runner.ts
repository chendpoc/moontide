import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEvalIntervention } from "./intervention.js";
import { createMoonTideEvalHarness } from "./moontide-harness.js";
import { evalLog } from "./progress-log.js";
import { runSuiteAbWithGate } from "./runner.js";
import { runProtocolChecks } from "./graders/protocol-checks.js";
import type { EvalReport, FeatureSurface, MoonTideEvalHarnessConfig, ProtocolCheckOutcome } from "./types.js";

export interface RunL1Options {
  suitePath?: string;
  featureSurface?: FeatureSurface;
  maxCases?: number;
  baseline?: MoonTideEvalHarnessConfig;
  candidate?: MoonTideEvalHarnessConfig;
}

export interface RunL1Result {
  report: EvalReport;
  agentErrors: string[];
  protocolNotes: string[];
}

function _protocolPass(outcome: ProtocolCheckOutcome): boolean {
  return (
    outcome.workMemUsed &&
    outcome.outlineBeforeTools &&
    outcome.decisionRecorded &&
    !outcome.synthesizeReminderFired
  );
}

/** L1: mock LLM agent-only run + deterministic protocol checks (no API key). */
export async function runL1Eval(options: RunL1Options = {}): Promise<RunL1Result> {
  process.env.MOONTIDE_EVAL_L1 = "1";

  const baseline = createMoonTideEvalHarness(
    options.baseline ?? { name: "baseline", disableProtocolReminders: true },
  );
  const candidate = createMoonTideEvalHarness(
    options.candidate ?? { name: "with-feature", disableProtocolReminders: false },
  );

  resolveEvalIntervention({ baseline, candidate });

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { report } = await runSuiteAbWithGate({
    suitePath: options.suitePath ?? "v2/regression",
    baseline,
    candidate,
    phase: "agent-only",
    artifactBaseDir: path.join(packageRoot, "runs"),
    featureSurface: options.featureSurface,
    maxCases: options.maxCases ?? 5,
    agentConcurrency: 2,
    verbose: false,
  });

  const agentErrors: string[] = [];
  const protocolNotes: string[] = [];

  for (const pair of report.pairs) {
    for (const arm of [pair.baseline, pair.candidate] as const) {
      if (arm.error) {
        agentErrors.push(`${pair.caseId} r${pair.repetition} ${arm.harnessName}: ${arm.error}`);
      }
      const protocol = runProtocolChecks(arm);
      if (!_protocolPass(protocol)) {
        protocolNotes.push(
          `${pair.caseId} r${pair.repetition} ${arm.harnessName}: ${protocol.details.join("; ")}`,
        );
      }
    }
  }

  evalLog(
    `L1 done pairs=${report.pairs.length} agentErrors=${agentErrors.length} protocolNotes=${protocolNotes.length}`,
  );

  delete process.env.MOONTIDE_EVAL_L1;

  return { report, agentErrors, protocolNotes };
}
