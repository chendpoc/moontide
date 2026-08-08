import { isThinkingEnabled, isVerboseEnabled } from "../modes.js";
import type { AgentChannel, AgentEvent } from "@moontide/log";
import { formatEventByChannel } from "./registry.js";
import { formatChannelSeparator, formatTurnBanner } from "./shared.js";

const TRACE_THINKING_KINDS = new Set(["thinking", "tool_use", "tool_result"]);

let lastRenderedTurn = -1;
let lastRenderedChannel: AgentChannel | null = null;

export function resetTerminalRenderState(): void {
  lastRenderedTurn = -1;
  lastRenderedChannel = null;
}

export function shouldPrintTerminalEvent(event: AgentEvent): boolean {
  if (event.kind === "plugin_error") {
    return isThinkingEnabled() || isVerboseEnabled();
  }

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
  return formatEventByChannel(event);
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
