import type { AgentPlatformOptions, AgentEventPipeline } from "../agent/event-pipeline.js";
import type { AgentRuntime } from "../agent/runtime/index.js";
import { setupToolsPorts } from "../agent/tools-setup.js";
import { getWorkdir } from "../config.js";
import { applyAgentEventPipeline, resetAgentEventPipeline, resetEventPlatform } from "../log/index.js";
import { registerBuiltinWorkMemPorts } from "../plugins/builtin/work-mem/register.js";
import { bootstrapPlugins } from "@moontide/sidecar-host";

/** Reset and register default sidecar run observers on the runtime. */
export function setupAgentObservers(runtime: AgentRuntime, workdir = getWorkdir()): void {
  runtime.resetSidecarObservers();
  runtime.registerDefaultSidecarObservers(workdir);
}

/** Observers + event pipeline — no plugin attach (tests and lightweight REPL turns). */
export function setupAgentEventPipeline(
  runtime: AgentRuntime,
  pipeline: AgentEventPipeline,
  observersWorkdir = getWorkdir(),
): void {
  setupAgentObservers(runtime, observersWorkdir);
  runtime.eventPipeline = pipeline;
  applyAgentEventPipeline(pipeline);
}

/** Full agent platform: observers, event pipeline, startup plugins. */
export async function bootstrapAgentPlatform(opts: AgentPlatformOptions): Promise<void> {
  setupToolsPorts();
  setupAgentObservers(opts.runtime, opts.workdir);
  opts.runtime.eventPipeline = opts.pipeline;
  applyAgentEventPipeline(opts.pipeline);
  registerBuiltinWorkMemPorts();
  await bootstrapPlugins(opts.workdir, opts.runtime.plugins);
}

export function teardownAgentPlatform(runtime: AgentRuntime): void {
  runtime.plugins.shutdown();
  runtime.resetSidecarObservers();
  runtime.eventPipeline = undefined;
  resetAgentEventPipeline();
  resetEventPlatform();
}

export type { AgentEventPipeline, AgentPlatformOptions } from "../agent/event-pipeline.js";
