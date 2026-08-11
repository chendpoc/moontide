import { setOutputs } from "@moontide/log";

import type { AgentEventOutputs } from "../agent/event-outputs.js";

let activeEventOutputs: AgentEventOutputs | undefined;

/** Register harness event outputs on the Agent Event hub (no terminal I/O). */
export function applyAgentEventOutputs(eventOutputs: AgentEventOutputs): void {
  activeEventOutputs = eventOutputs;
  setOutputs(eventOutputs.outputs);
}

/** Event outputs last applied via applyAgentEventOutputs (independent of getAgentRuntime()). */
export function getActiveEventOutputs(): AgentEventOutputs | undefined {
  return activeEventOutputs;
}

export function resetAgentEventOutputs(): void {
  activeEventOutputs = undefined;
}
