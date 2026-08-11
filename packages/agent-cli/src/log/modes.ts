import { thinkingModeDefault, verboseModeDefault } from "@moontide/agent";

let thinkingOverride: boolean | null = null;
let verboseOverride: boolean | null = null;

export function isVerboseEnabled(): boolean {
  if (verboseOverride !== null) {
    return verboseOverride;
  }
  return verboseModeDefault();
}

export function isThinkingEnabled(): boolean {
  if (isVerboseEnabled()) {
    return true;
  }
  if (thinkingOverride !== null) {
    return thinkingOverride;
  }
  return thinkingModeDefault();
}

export function isObservabilityEnabled(): boolean {
  return isThinkingEnabled() || isVerboseEnabled();
}

export function setThinkingOverride(value: boolean | null): void {
  thinkingOverride = value;
}

export function setVerboseOverride(value: boolean | null): void {
  verboseOverride = value;
}

export function describeObservabilityModes(): string {
  const thinking = isThinkingEnabled() ? "on" : "off";
  const verbose = isVerboseEnabled() ? "on" : "off";
  return `thinking: ${thinking} · verbose: ${verbose}`;
}

export function resetObservabilityOverrides(): void {
  thinkingOverride = null;
  verboseOverride = null;
}
