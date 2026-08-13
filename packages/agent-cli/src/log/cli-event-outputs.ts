import { JsonlWriter } from "@moontide/agent/observability";

import type { AgentEventOutputs } from "@moontide/agent";
import { reportError, type ReportErrorOptions } from "../errors/report.js";

export function createCliEventOutputs(workdir: string): AgentEventOutputs {
	return {
		outputs: [new JsonlWriter({ workdir })],
		publishError: (record, options) =>
			reportError(record, options as ReportErrorOptions | undefined),
	};
}
