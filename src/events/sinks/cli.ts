import { shouldShowContextCli, shouldShowEventsCli, shouldShowTraceCli } from "../../cli/display-session.js";
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
