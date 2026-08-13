import type { EventDraft } from "../../log/types.js";
import type { StepObserveResult } from "./types.js";

function isStepObserveObject(
	value: StepObserveResult,
): value is Extract<
	StepObserveResult,
	{ events?: unknown; modelAppend?: string }
> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!("channel" in value) &&
		("events" in value || "modelAppend" in value)
	);
}

export function parseStepObserveResult(value: StepObserveResult): {
	drafts: EventDraft[];
	modelAppend?: string;
} {
	if (!value) {
		return { drafts: [] };
	}
	if (Array.isArray(value)) {
		return { drafts: value };
	}
	if (isStepObserveObject(value)) {
		const nested = value.events
			? parseStepObserveResult(value.events)
			: { drafts: [] };
		return {
			drafts: nested.drafts,
			modelAppend: value.modelAppend,
		};
	}
	return { drafts: [value] };
}
