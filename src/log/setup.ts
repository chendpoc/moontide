import { setOutputs, type EventOutput } from "./event-hub.js";
import { JsonlWriter } from "./outputs/jsonl.js";
import { StderrRenderer } from "./outputs/stderr-renderer.js";

/** Connect Agent Event outputs (jsonl + stderr). No hooks or plugins. */
export function configureOutputs(): void {
  const eventOutputs: EventOutput[] = [new JsonlWriter(), new StderrRenderer()];
  setOutputs(eventOutputs);
}

export function refreshEventOutputs(): void {
  configureOutputs();
}

export function resetEventPlatform(): void {
  setOutputs([]);
}
