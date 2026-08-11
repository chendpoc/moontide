import { appendDebugRecord } from "./debug-file.js";
import { formatDebugRecord } from "./debug-format.js";
import { isDebugFileEnabled, isDebugTerminalEnabled } from "./debug-mode.js";
import { getAgentRuntime } from "../agent/runtime/index.js";
import { getWorkdir } from "../config.js";

export interface DebugRecord {
  kind: string;
  turn: number;
  [key: string]: unknown;
}

/** Emit one full debug record to event outputs terminal slot and/or `.moontide/debug/` per active tier. */
export function emitDebugRecord(record: DebugRecord, workdir = getWorkdir()): void {
  if (!isDebugTerminalEnabled() && !isDebugFileEnabled()) {
    return;
  }

  if (isDebugTerminalEnabled()) {
    getAgentRuntime().eventOutputs?.writeDebugTerminal?.(formatDebugRecord(record));
  }
  if (isDebugFileEnabled()) {
    appendDebugRecord(record, workdir);
  }
}
