import { formatContextEvent } from "../format/format-context.js";
import { formatEventsChannelEvent } from "../format/format-events.js";
import { formatTraceEvent } from "../format/format-trace.js";
import {
  formatChannelSeparator,
  formatTurnBanner,
} from "../format/shared.js";
import type { EventSink } from "../bus.js";
import type { AgentChannel, AgentEvent } from "../types.js";
import { writeStderrBlock } from "./stderr-writer.js";

/** Reserved for future stderr observability — not registered in setup.ts. */
let contextOverride: boolean | null = null;
let traceOverride: boolean | null = null;
let eventsDisplayOverride: boolean | null = null;

export function setContextCliOverride(value: boolean | null): void {
  contextOverride = value;
}

export function setTraceCliOverride(value: boolean | null): void {
  traceOverride = value;
}

export function setEventsDisplayCliOverride(value: boolean | null): void {
  eventsDisplayOverride = value;
}

function shouldShowContextCli(): boolean {
  return contextOverride === true;
}

function shouldShowTraceCli(): boolean {
  return traceOverride === true;
}

function shouldShowEventsCli(): boolean {
  return eventsDisplayOverride === true;
}

export function formatEventForCli(event: AgentEvent): string | null {
  if (event.channel === "context") {
    if (!shouldShowContextCli()) {
      return null;
    }
    return formatContextEvent(event);
  }
  if (event.channel === "trace") {
    if (!shouldShowTraceCli()) {
      return null;
    }
    return formatTraceEvent(event);
  }
  if (event.channel === "conversation" || event.channel === "audit") {
    if (!shouldShowEventsCli()) {
      return null;
    }
    return formatEventsChannelEvent(event);
  }
  return null;
}

let lastRenderedTurn = -1;
let lastRenderedChannel: AgentChannel | null = null;

/** Reset turn/channel tracking (tests). */
export function resetCliRenderState(): void {
  lastRenderedTurn = -1;
  lastRenderedChannel = null;
}

function composeCliBlock(event: AgentEvent, block: string): string {
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

export class CliSink implements EventSink {
  handle(event: AgentEvent): void {
    const block = formatEventForCli(event);
    if (!block) {
      return;
    }
    writeStderrBlock(composeCliBlock(event, block));
  }

  close(): void {
    resetCliRenderState();
  }
}
