import { setSinks } from "./bus.js";
import type { EventSink } from "./bus.js";
import { isEventsMode } from "./cli-session.js";
import { registerAllPlugins } from "./register-plugins.js";
import { CliSink } from "./sinks/cli.js";
import { JsonlSink } from "./sinks/jsonl.js";
import { NdjsonStdoutSink } from "./sinks/ndjson.js";

function configureSinks(): void {
  const jsonl = new JsonlSink();
  const sinks: EventSink[] = [jsonl, new CliSink()];
  if (isEventsMode()) {
    sinks.push(new NdjsonStdoutSink());
  }
  setSinks(sinks);
}

export function setupEventPipeline(): void {
  registerAllPlugins();
  configureSinks();
}

export function refreshEventSinks(): void {
  configureSinks();
}

export function resetEventPlatform(): void {
  setSinks([]);
}
