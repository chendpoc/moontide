import { getWorkdir } from "../config.js";
import {
  registerDefaultSidecarHooks,
  resetSidecarHooks,
} from "../agent/hooks/index.js";
import { bootstrapPlugins, resetPluginHost } from "../plugin-host/index.js";
import { setOutputs, type EventOutput } from "./event-hub.js";
import { JsonlWriter } from "./outputs/jsonl.js";
import { StderrRenderer } from "./outputs/stderr-renderer.js";

function configureOutputs(): void {
  const eventOutputs: EventOutput[] = [new JsonlWriter(), new StderrRenderer()];
  setOutputs(eventOutputs);
}

export function setupEventPipeline(): void {
  resetSidecarHooks();
  registerDefaultSidecarHooks();
  configureOutputs();
}

export async function bootstrapEventPlatform(workdir = getWorkdir()): Promise<void> {
  setupEventPipeline();
  await bootstrapPlugins(workdir);
}

export function teardownEventPlatform(): void {
  resetPluginHost();
  resetSidecarHooks();
  setOutputs([]);
}

export function refreshEventOutputs(): void {
  configureOutputs();
}

export function resetEventPlatform(): void {
  setOutputs([]);
}
