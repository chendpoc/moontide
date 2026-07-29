import { setSinks } from "./bus.js";
import type { EventSink } from "./bus.js";
import { registerAllPlugins } from "./register-plugins.js";
import { JsonlSink } from "./sinks/jsonl.js";
import { TerminalSink } from "./sinks/terminal.js";

function configureSinks(): void {
  const sinks: EventSink[] = [new JsonlSink(), new TerminalSink()];
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
