import type { DebugLevel } from "@moontide/shared/constants/debug.js";
import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { debugModeDefault } from "../config.js";

let debugOverride: DebugLevel | null = null;

export function getDebugLevel(): DebugLevel {
  if (debugOverride !== null) {
    return debugOverride;
  }
  return debugModeDefault();
}

export function isDebugFileEnabled(): boolean {
  return getDebugLevel() === "file";
}

export function setDebugOverride(level: DebugLevel | null): void {
  debugOverride = level;
}

export function resetDebugOverride(): void {
  debugOverride = null;
}

const debugFileHint = `${DATA_DIR}/debug/<sessionId>.jsonl`;

export function describeDebugMode(): string {
  const level = getDebugLevel();
  if (level === "off") {
    return "debug: off";
  }
  return `debug: file (${debugFileHint})`;
}

export function parseDebugLevelArg(arg: string | undefined): DebugLevel | null | "status" {
  if (!arg || arg === "status") {
    return "status";
  }
  if (arg === "off" || arg === "0" || arg === "false") {
    return "off";
  }
  if (arg === "on" || arg === "1" || arg === "true" || arg === "file" || arg === "terminal") {
    return "file";
  }
  return null;
}
