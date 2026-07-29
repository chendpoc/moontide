import type { AgentEvent, EnrichedAgentEvent } from "./types.js";

function buildSummary(event: AgentEvent): string {
  const preview = event.preview?.trim();
  switch (event.channel) {
    case "context":
      return preview ? `context/${event.kind} ${preview}` : `context/${event.kind}`;
    case "trace":
      return preview ? `trace/${event.kind} ${preview}` : `trace/${event.kind}`;
    case "conversation":
      return preview ? `${event.kind} ${preview}` : event.kind;
    case "audit": {
      const toolName = String(event.payload.toolName ?? preview ?? "tool");
      return `audit/${event.kind} ${toolName}`;
    }
    default:
      return preview ?? event.kind;
  }
}

/** Add grep-friendly metadata without changing core AgentEvent fields. */
export function enrichEvent(event: AgentEvent): EnrichedAgentEvent {
  return {
    ...event,
    displayHint: event.channel,
    summary: buildSummary(event),
  };
}
