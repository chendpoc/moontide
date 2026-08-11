export {
  emit,
  finalizeRunOutputs,
  getOutputs,
  setOutputs,
  subscribe,
  enableTestCollector,
  disableTestCollector,
  getCollectedEvents,
  collectEvents,
} from "./event-hub.js";
export type { EventListener, EventOutput } from "./event-hub.js";
export { enrichEvent } from "./enrich.js";
export { configureJsonlOutput, resetEventPlatform } from "./setup.js";
export type { ConfigureJsonlOptions } from "./setup.js";
export { getRunId, resetRun, setOnResetRun } from "./run.js";
export { serializePersistedEvent } from "./persist.js";
export type { PersistedAgentEvent, SerializedEvent } from "./persist.js";
export { JsonlWriter } from "./outputs/jsonl.js";
export type { JsonlWriterOptions } from "./outputs/jsonl.js";
export type {
  AgentChannel,
  AgentEvent,
  AgentKind,
  AgentPhase,
  EnrichedAgentEvent,
  EventDraft,
  EventLogMeta,
} from "./types.js";

// Re-export RunEvent types for RunEvent → Agent Event bridge consumers (derive stays in app).
export type { RunEvent } from "@moontide/run-protocol";
