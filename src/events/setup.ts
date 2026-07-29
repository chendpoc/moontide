import { setOutputs } from "./bus.js";
import type { EventOutput } from "./bus.js";
import { registerAllPlugins } from "./register-plugins.js";
import { JsonlWriter } from "./outputs/jsonl.js";
import { StderrRenderer } from "./outputs/stderr-renderer.js";

function configureOutputs(): void {
  const eventOutputs: EventOutput[] = [new JsonlWriter(), new StderrRenderer()];
  setOutputs(eventOutputs);
}

export function setupEventPipeline(): void {
  registerAllPlugins();
  configureOutputs();
}

export function refreshEventOutputs(): void {
  configureOutputs();
}

export function resetEventPlatform(): void {
  setOutputs([]);
}
