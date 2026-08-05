import type { DebugLevel } from "../constants/debug.js";
import { DATA_DIR } from "../constants/storage.js";
import { debugModeDefault } from "../config.js";

let debugOverride: DebugLevel | null = null;

export function getDebugLevel(): DebugLevel {
  if (debugOverride !== null) {
    return debugOverride;
  }
  return debugModeDefault();
}

/** Level 1+ — full untruncated dumps to stderr. */
export function isDebugTerminalEnabled(): boolean {
  const level = getDebugLevel();
  return level === "terminal" || level === "file";
}

/** Level 1+ — append full records to `${DATA_DIR}/debug/<runId>.jsonl`. */
export function isDebugFileEnabled(): boolean {
  const level = getDebugLevel();
  return level === "terminal" || level === "file";
}

export function setDebugOverride(level: DebugLevel | null): void {
  debugOverride = level;
}

export function resetDebugOverride(): void {
  debugOverride = null;
}

const debugFileHint = `${DATA_DIR}/debug/<runId>.jsonl`;

export function describeDebugMode(): string {
  const level = getDebugLevel();
  if (level === "off") {
    return "debug: off";
  }
  if (level === "terminal") {
    return `debug: terminal (stderr + ${debugFileHint})`;
  }
  return `debug: file (same as terminal — stderr + ${debugFileHint})`;
}

export function parseDebugLevelArg(arg: string | undefined): DebugLevel | null | "status" {
  if (!arg || arg === "status") {
    return "status";
  }
  if (arg === "off" || arg === "0" || arg === "false") {
    return "off";
  }
  if (arg === "on" || arg === "1" || arg === "true" || arg === "terminal") {
    return "terminal";
  }
  if (arg === "file") {
    return "file";
  }
  return null;
}
