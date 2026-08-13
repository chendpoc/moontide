import type { AgentChannel, AgentPhase } from "../log/index.js";
import type { EventOutput } from "../log/index.js";
import type { ErrorRecord } from "@moontide/shared/errors/record.js";

import { internalError } from "@moontide/shared/errors/factories.js";

import type { AgentRuntime } from "./runtime/index.js";
import { getAgentRuntime } from "./runtime/index.js";
import { getActiveEventOutputs } from "../log/event-outputs.js";

export interface AgentErrorRoute {
	channel: AgentChannel;
	phase: AgentPhase;
	turn?: number;
	hook?: string;
	toolName?: string;
	toolUseId?: string;
}

export interface PublishAgentErrorOptions {
	stderr?: boolean;
	event?: boolean;
	debug?: boolean;
	route?: AgentErrorRoute;
}

/** Event outputs + structured error publication (stderr formatting supplied by CLI). */
export interface AgentEventOutputs {
	outputs: EventOutput[];
	publishError(record: ErrorRecord, options?: PublishAgentErrorOptions): void;
	writeDebugTerminal?: (formatted: string) => void;
}

export interface AgentPlatformOptions {
	workdir: string;
	runtime: AgentRuntime;
	eventOutputs: AgentEventOutputs;
}

export function publishAgentError(
	record: ErrorRecord,
	options: PublishAgentErrorOptions = {},
): void {
	const eventOutputs =
		getActiveEventOutputs() ?? getAgentRuntime().eventOutputs;
	if (!eventOutputs) {
		throw internalError(
			"AgentEventOutputs not configured; call bootstrapAgentPlatform first",
		);
	}
	eventOutputs.publishError(record, options);
}
