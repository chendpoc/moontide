import type { AgentChannel, AgentEvent } from "../types.js";
import { formatContextEvent } from "./format-context.js";
import { formatEventsChannelEvent } from "./format-events.js";
import { formatTraceEvent } from "./format-trace.js";
import { isVerboseEnabled } from "../modes.js";

export type ChannelFormatter = (event: AgentEvent) => string | null;

export const CHANNEL_FORMATTERS: Partial<Record<AgentChannel, ChannelFormatter>> = {
  trace: formatTraceEvent,
  context: formatContextEvent,
  conversation: formatEventsChannelEvent,
  tool_use_log: formatEventsChannelEvent,
};

export function formatEventByChannel(event: AgentEvent): string | null {
  const formatter = CHANNEL_FORMATTERS[event.channel];
  if (formatter) {
    return formatter(event);
  }
  return isVerboseEnabled() ? `${event.channel}/${event.kind} ${event.preview ?? ""}` : null;
}

export type ChannelSummaryBuilder = (event: AgentEvent) => string;

export const CHANNEL_SUMMARY_BUILDERS: Partial<Record<AgentChannel, ChannelSummaryBuilder>> = {
  context: (event) => {
    const preview = event.preview?.trim();
    return preview ? `context/${event.kind} ${preview}` : `context/${event.kind}`;
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

export function buildEventSummary(event: AgentEvent): string {
  const builder = CHANNEL_SUMMARY_BUILDERS[event.channel];
  if (builder) {
    return builder(event);
  }
  return event.preview?.trim() ?? event.kind;
}
