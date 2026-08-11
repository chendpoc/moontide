import { getWorkdir } from "../config.js";
import { appendNdjsonLine, ensureDirForFile } from "@moontide/shared/storage/fs.js";
import { getRunId } from "../log/index.js";
import { dataPath } from "@moontide/shared/utils/path.js";
import type { DebugRecordBase } from "./debug-format.js";

const DEBUG_DIR = "debug";

export function debugLogPath(workdir = getWorkdir(), runId = getRunId()): string {
  return dataPath(workdir, DEBUG_DIR, `${runId}.jsonl`);
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
