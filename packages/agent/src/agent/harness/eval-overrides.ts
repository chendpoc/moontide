/** Eval-only harness overrides (set by @moontide/evals; default production behavior). */
let protocolRemindersEnabled = true;

export function setEvalProtocolRemindersEnabled(enabled: boolean): void {
  protocolRemindersEnabled = enabled;
}

export function isEvalProtocolRemindersEnabled(): boolean {
  return protocolRemindersEnabled;
}

export function resetEvalHarnessOverrides(): void {
  protocolRemindersEnabled = true;
}
