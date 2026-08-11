import { setOutputs } from "@moontide/log";

import type { AgentEventPipeline } from "../agent/event-pipeline.js";

let activePipeline: AgentEventPipeline | undefined;

/** Register harness event outputs on the Agent Event hub (no terminal I/O). */
export function applyAgentEventPipeline(pipeline: AgentEventPipeline): void {
  activePipeline = pipeline;
  setOutputs(pipeline.outputs);
}

/** Pipeline last applied via applyAgentEventPipeline (independent of getAgentRuntime()). */
export function getActiveEventPipeline(): AgentEventPipeline | undefined {
  return activePipeline;
}

export function resetAgentEventPipeline(): void {
  activePipeline = undefined;
}
