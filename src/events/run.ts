import { randomBytes, randomUUID } from "node:crypto";

import { resetTerminalRenderState } from "./format/terminal.js";
import type { AgentEvent, EventDraft } from "./types.js";

/** Filesystem-safe run id: YYYYMMDD-HHmmss-<8 hex>. */
export function newRunId(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("");
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  return `${date}-${time}-${randomBytes(4).toString("hex")}`;
}

let runId: string = newRunId();
let seq = 0;

export function resetRun(id?: string): string {
  runId = id ?? newRunId();
  seq = 0;
  resetTerminalRenderState();
  return runId;
}

export function getRunId(): string {
  return runId;
}

export function finalizeEvent(draft: EventDraft): AgentEvent {
  seq += 1;
  return {
    ...draft,
    id: String(randomUUID()),
    seq,
    runId,
    ts: Date.now(),
  };
}
