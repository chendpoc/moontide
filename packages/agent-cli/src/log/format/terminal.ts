import type { AgentChannel, AgentEvent } from "@moontide/agent/observability";
import { formatChannelSeparator, formatTurnBanner } from "./shared.js";

let lastRenderedTurn = -1;
let lastRenderedChannel: AgentChannel | null = null;

export function resetTerminalRenderState(): void {
	lastRenderedTurn = -1;
	lastRenderedChannel = null;
}

/** Terminal Agent Event rendering is disabled; use runs jsonl + debug file instead. */
export function shouldPrintTerminalEvent(_event: AgentEvent): boolean {
	return false;
}

export function formatTerminalEventBlock(_event: AgentEvent): string | null {
	return null;
}

export function composeTerminalBlock(event: AgentEvent, block: string): string {
	const parts: string[] = [];

	if (event.turn !== lastRenderedTurn) {
		if (lastRenderedTurn >= 0) {
			parts.push("");
		}
		parts.push(formatTurnBanner(event.turn));
		lastRenderedTurn = event.turn;
		lastRenderedChannel = null;
	}

	if (lastRenderedChannel && lastRenderedChannel !== event.channel) {
		parts.push(formatChannelSeparator(lastRenderedChannel, event.channel));
	}

	lastRenderedChannel = event.channel;
	parts.push(block);
	return parts.join("\n");
}
