/** Structured progress lines on stderr (always on during eval runs). */
export function evalLog(message: string): void {
  process.stderr.write(`[eval] ${message}\n`);
}

/** Subprocess / harness detail (only when --verbose). */
export function evalVerbose(enabled: boolean, message: string): void {
  if (!enabled) {
    return;
  }
  process.stderr.write(`[eval:verbose] ${message}\n`);
}

export function formatAgentJobSummary(
  baseline: { durationMs: number; turn: number; toolCallCount: number; error?: string },
  candidate: { durationMs: number; turn: number; toolCallCount: number; error?: string },
): string {
  const err = baseline.error ?? candidate.error;
  if (err) {
    return `error=${err}`;
  }
  return (
    `baseline=${baseline.durationMs}ms/${baseline.turn}t/${baseline.toolCallCount}tools ` +
    `candidate=${candidate.durationMs}ms/${candidate.turn}t/${candidate.toolCallCount}tools`
  );
}
