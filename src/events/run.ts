import { randomUUID } from "node:crypto";

import { resetTerminalRenderState } from "./format/terminal.js";
import type { AgentEvent, EventDraft } from "./types.js";

let runId: string = randomUUID();
let seq = 0;

export function resetRun(id?: string): string {
  runId = id ?? randomUUID();
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
