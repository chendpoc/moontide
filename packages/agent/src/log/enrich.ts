import type { AgentChannel, AgentEvent, EnrichedAgentEvent } from "./types.js";

type ChannelSummaryBuilder = (event: AgentEvent) => string;

const CHANNEL_SUMMARY_BUILDERS: Partial<
	Record<AgentChannel, ChannelSummaryBuilder>
> = {
	context: (event) => {
		const preview = event.preview?.trim();
		return preview
			? `context/${event.kind} ${preview}`
			: `context/${event.kind}`;
	},
	trace: (event) => {
		const preview = event.preview?.trim();
		return preview ? `trace/${event.kind} ${preview}` : `trace/${event.kind}`;
	},
	conversation: (event) => {
		const preview = event.preview?.trim();
		return preview ? `${event.kind} ${preview}` : event.kind;
	},
	tool_use_log: (event) => {
		const preview = event.preview?.trim();
		const toolName = String(event.payload.toolName ?? preview ?? "tool");
		return `tool_use_log/${event.kind} ${toolName}`;
	},
};

function buildEventSummary(event: AgentEvent): string {
	const builder = CHANNEL_SUMMARY_BUILDERS[event.channel];
	if (builder) {
		return builder(event);
	}
	return event.preview?.trim() ?? event.kind;
}

/** Add grep-friendly metadata without changing core AgentEvent fields. */
export function enrichEvent(event: AgentEvent): EnrichedAgentEvent {
	return {
		...event,
		displayHint: event.channel,
		summary: buildEventSummary(event),
	};
}
