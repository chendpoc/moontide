import { setOutputs } from "./bus.js";
import type { EventOutput } from "./bus.js";

import { JsonlWriter } from "./outputs/jsonl.js";
import { StderrRenderer } from "./outputs/stderr-renderer.js";

import { resetPlugins } from "../agent/pipeline/registry.js";


function configureOutputs(): void {
  const eventOutputs: EventOutput[] = [new JsonlWriter(), new StderrRenderer()];
  setOutputs(eventOutputs);
}

export function setupEventPipeline(): void {
  resetPlugins();
  configureOutputs();
}

export function refreshEventOutputs(): void {
  configureOutputs();
}

export function resetEventPlatform(): void {
  setOutputs([]);
}
