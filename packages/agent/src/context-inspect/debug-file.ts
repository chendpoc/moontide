import fs from "node:fs";

import { appendNdjsonLine, ensureDirForFile } from "@moontide/shared/storage/fs.js";
import { dataPath } from "@moontide/shared/utils/path.js";
import { getWorkdir } from "../config.js";
import { getRunId } from "../log/index.js";
import type { DebugRecordBase } from "./debug-format.js";

const DEBUG_DIR = "debug";

let debugLogKeyOverride: string | undefined;

/** REPL / harness: stable debug log key for the session (falls back to runId when unset). */
export function setDebugLogKey(key: string | null): void {
  debugLogKeyOverride = key ?? undefined;
}

export function resetDebugLogKey(): void {
  debugLogKeyOverride = undefined;
}

function resolveDebugLogKey(fallbackRunId = getRunId()): string {
  return debugLogKeyOverride ?? fallbackRunId;
}

export function debugLogPath(workdir = getWorkdir(), logKey?: string): string {
  const key = logKey ?? resolveDebugLogKey();
  return dataPath(workdir, DEBUG_DIR, `${key}.jsonl`);
}

/** Create debug log file when debug is enabled but no turn has written yet. */
export function ensureDebugLogFile(workdir = getWorkdir()): string {
  const path = debugLogPath(workdir);
  ensureDirForFile(path);
  if (!fs.existsSync(path)) {
    fs.closeSync(fs.openSync(path, "a"));
  }
  return path;
}

/** Append one full debug record (no size cap — unlike Agent Event Log). */
export function appendDebugRecord(
  record: DebugRecordBase & Record<string, unknown>,
  workdir = getWorkdir(),
): void {
  const path = debugLogPath(workdir);
  ensureDirForFile(path);
  appendNdjsonLine(path, `${JSON.stringify({ ...record, ts: Date.now(), runId: getRunId() })}\n`);
}
