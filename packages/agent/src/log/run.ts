import { newEventId, newTimestampedId } from "@moontide/shared/utils/id.js";
import type { AgentEvent, EventDraft } from "./types.js";

let runId: string = newTimestampedId();
let seq = 0;
let onResetRun: (() => void) | undefined;

/** Optional hook for app-layer terminal render reset on new run. */
export function setOnResetRun(callback: (() => void) | undefined): void {
	onResetRun = callback;
}

export function resetRun(id?: string): string {
	runId = id ?? newTimestampedId();
	seq = 0;
	onResetRun?.();
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
