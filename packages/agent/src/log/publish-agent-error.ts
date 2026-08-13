import { emit } from "./event-hub.js";
import {
	errorRecordToEventPayload,
	type ErrorRecord,
} from "@moontide/shared/errors/record.js";

import type { PublishAgentErrorOptions } from "../agent/event-outputs.js";

/** Structured plugin_error emit via log hub (no CLI stderr). */
export function publishHarnessAgentError(
	record: ErrorRecord,
	options: PublishAgentErrorOptions = {},
): void {
	const event = options.event ?? Boolean(options.route);
	if (!event || !options.route) {
		return;
	}

	const { channel, phase, turn, hook, toolName, toolUseId } = options.route;
	emit({
		turn: turn ?? record.turn ?? 0,
		phase,
		channel,
		kind: "plugin_error",
		payload: {
			...errorRecordToEventPayload(record),
			hook: hook ?? record.hook,
			toolName: toolName ?? record.toolName,
			toolUseId: toolUseId ?? record.toolUseId,
		},
		preview: `${hook ?? record.hook ?? record.source}/${phase}`,
	});
}
