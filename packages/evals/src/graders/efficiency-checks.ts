import type { EfficiencyMetrics, EvalRunOutput } from "../types.js";

export function efficiencyFromOutput(output: EvalRunOutput): EfficiencyMetrics {
  return {
    turnCount: output.turn,
    toolCallCount: output.toolCallCount,
    inputTokens: output.inputTokens,
    outputTokens: output.outputTokens,
    durationMs: output.durationMs,
  };
}

export function runEfficiencyChecks(output: EvalRunOutput): EfficiencyMetrics {
  return efficiencyFromOutput(output);
}
