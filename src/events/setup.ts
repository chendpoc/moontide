import { setSinks } from "./bus.js";
import type { EventSink } from "./bus.js";
import { registerAllPlugins } from "./register-plugins.js";
import { JsonlSink } from "./sinks/jsonl.js";

function configureSinks(): void {
  const sinks: EventSink[] = [new JsonlSink()];
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
