import type { HarnessTableRow, MoonTideEvalHarnessConfig } from "./types.js";

export interface EvalHarnessTableInput {
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
  repetitions?: number;
}

/** Pair baseline and candidate harness configs for A/B comparison runs. */
export function evalHarnessTable(
  _suiteName: string,
  input: EvalHarnessTableInput,
): HarnessTableRow[] {
  const repetitions = input.repetitions ?? 1;
  const rows: HarnessTableRow[] = [];

  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    rows.push({
      name: input.baseline.name,
      harness: input.baseline,
      repetition,
    });
    rows.push({
      name: input.candidate.name,
      harness: input.candidate,
      repetition,
    });
  }

  return rows;
}
