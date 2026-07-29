import type { EventSink } from "../bus.js";
import { isEventsMode } from "../../cli/display-session.js";
import { enrichEvent } from "../enrich.js";
import type { AgentEvent } from "../types.js";

/** Writes AgentEvent NDJSON to stdout when events mode is active. */
export class NdjsonStdoutSink implements EventSink {
  handle(event: AgentEvent): void {
    if (!isEventsMode()) {
      return;
    }
    process.stdout.write(`${JSON.stringify(enrichEvent(event))}\n`);
  }
}
