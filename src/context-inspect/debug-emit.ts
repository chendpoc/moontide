import { getWorkdir } from "../config.js";
import { writeStderrBlock } from "../terminal/write.js";
import { appendDebugRecord } from "./debug-file.js";
import { formatDebugRecord } from "./debug-format.js";
import { isDebugFileEnabled, isDebugTerminalEnabled } from "./debug-mode.js";

export interface DebugRecord {
  kind: string;
  turn: number;
  [key: string]: unknown;
}

/** Emit one full debug record to stderr and/or `.ocula/debug/` per active tier. */
export function emitDebugRecord(record: DebugRecord, workdir = getWorkdir()): void {
  if (!isDebugTerminalEnabled() && !isDebugFileEnabled()) {
    return;
  }

  if (isDebugTerminalEnabled()) {
    writeStderrBlock(formatDebugRecord(record));
  }
  if (isDebugFileEnabled()) {
    appendDebugRecord(record, workdir);
  }
}
