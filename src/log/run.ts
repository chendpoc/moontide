import { newEventId, newTimestampedId } from "../utils/id.js";
import { resetTerminalRenderState } from "./format/terminal.js";
import type { AgentEvent, EventDraft } from "./types.js";

let runId: string = newTimestampedId();
let seq = 0;

export function resetRun(id?: string): string {
  runId = id ?? newTimestampedId();
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
    id: newEventId(),
    seq,
    runId,
    ts: Date.now(),
  };
}
