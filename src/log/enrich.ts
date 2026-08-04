import type { AgentEvent, EnrichedAgentEvent } from "./types.js";
import { buildEventSummary } from "./format/registry.js";

/** Add grep-friendly metadata without changing core AgentEvent fields. */
export function enrichEvent(event: AgentEvent): EnrichedAgentEvent {
  return {
    ...event,
    displayHint: event.channel,
    summary: buildEventSummary(event),
  };
}
