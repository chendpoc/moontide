import { isVerboseEnabled } from "../../observability/modes.js";
import type { AgentChannel, AgentEvent } from "../types.js";
import { formatContextEvent } from "./format-context.js";
import { formatEventsChannelEvent } from "./format-events.js";
import { formatTraceEvent } from "./format-trace.js";
import { formatChannelSeparator, formatTurnBanner } from "./shared.js";

const TRACE_THINKING_KINDS = new Set(["thinking", "tool_use", "tool_result"]);

let lastRenderedTurn = -1;
let lastRenderedChannel: AgentChannel | null = null;

export function resetTerminalRenderState(): void {
  lastRenderedTurn = -1;
  lastRenderedChannel = null;
}

export function shouldPrintTerminalEvent(event: AgentEvent): boolean {
  if (event.channel === "trace") {
    if (isVerboseEnabled()) {
      return true;
    }
    return TRACE_THINKING_KINDS.has(event.kind);
  }
  return isVerboseEnabled();
}

export function formatTerminalEventBlock(event: AgentEvent): string | null {
  if (!shouldPrintTerminalEvent(event)) {
    return null;
  }

  switch (event.channel) {
    case "trace":
      return formatTraceEvent(event);
    case "context":
      return formatContextEvent(event);
    case "conversation":
    case "audit":
      return formatEventsChannelEvent(event);
    default:
      return isVerboseEnabled()
        ? `${event.channel}/${event.kind} ${event.preview ?? ""}`
        : null;
  }
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
