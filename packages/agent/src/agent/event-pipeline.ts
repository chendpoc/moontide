import type { AgentChannel, AgentPhase, EventOutput } from "@moontide/log";
import type { ErrorRecord } from "@moontide/shared/errors/record.js";

import { internalError } from "@moontide/shared/errors/factories.js";

import type { AgentRuntime } from "./runtime/index.js";
import { getAgentRuntime } from "./runtime/index.js";
import { getActiveEventPipeline } from "../log/event-pipeline.js";

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

/** Event outputs + structured error publication (stderr formatting supplied by CLI pipeline). */
export interface AgentEventPipeline {
  outputs: EventOutput[];
  publishError(record: ErrorRecord, options?: PublishAgentErrorOptions): void;
  writeDebugTerminal?: (formatted: string) => void;
}

export interface AgentPlatformOptions {
  workdir: string;
  runtime: AgentRuntime;
  pipeline: AgentEventPipeline;
}

export function publishAgentError(
  record: ErrorRecord,
  options: PublishAgentErrorOptions = {},
): void {
  const pipeline =
    getActiveEventPipeline() ?? getAgentRuntime().eventPipeline;
  if (!pipeline) {
    throw internalError("AgentEventPipeline not configured; call bootstrapAgentPlatform first");
  }
  pipeline.publishError(record, options);
}
