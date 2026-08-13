import { appendDebugRecord } from "./debug-file.js";
import { isDebugFileEnabled } from "./debug-mode.js";
import { getWorkdir } from "../config.js";

export interface DebugRecord {
  kind: string;
  turn: number;
  [key: string]: unknown;
}

/** Append one full debug record to `.moontide/debug/<sessionId>.jsonl` when debug file tier is on. */
export function emitDebugRecord(record: DebugRecord, workdir = getWorkdir()): void {
  if (!isDebugFileEnabled()) {
    return;
  }
  appendDebugRecord(record, workdir);
}
