import type { AgentPlatformOptions, AgentEventOutputs } from "../agent/event-outputs.js";
import type { AgentRuntime } from "../agent/runtime/index.js";
import { setupToolsPorts } from "../agent/tools-setup.js";
import { getWorkdir } from "../config.js";
import { applyAgentEventOutputs, resetAgentEventOutputs, resetEventPlatform } from "../log/index.js";
import { registerBuiltinWorkMemPorts } from "../plugins/builtin/work-mem/register.js";
import { bootstrapPlugins } from "@moontide/sidecar-host";

/** Reset and register default sidecar run observers on the runtime. */
export function setupAgentObservers(runtime: AgentRuntime, workdir = getWorkdir()): void {
  runtime.resetSidecarObservers();
  runtime.registerDefaultSidecarObservers(workdir);
}

/** Observers + event outputs — no plugin attach (tests and lightweight REPL turns). */
export function setupAgentEventOutputs(
  runtime: AgentRuntime,
  eventOutputs: AgentEventOutputs,
  observersWorkdir = getWorkdir(),
): void {
  setupAgentObservers(runtime, observersWorkdir);
  runtime.eventOutputs = eventOutputs;
  applyAgentEventOutputs(eventOutputs);
}

/** Full agent platform: observers, event outputs, startup plugins. */
export async function bootstrapAgentPlatform(opts: AgentPlatformOptions): Promise<void> {
  setupToolsPorts();
  setupAgentObservers(opts.runtime, opts.workdir);
  opts.runtime.eventOutputs = opts.eventOutputs;
  applyAgentEventOutputs(opts.eventOutputs);
  registerBuiltinWorkMemPorts();
  await bootstrapPlugins(opts.workdir, opts.runtime.plugins);
}

export function teardownAgentPlatform(runtime: AgentRuntime): void {
  runtime.plugins.shutdown();
  runtime.resetSidecarObservers();
  runtime.eventOutputs = undefined;
  resetAgentEventOutputs();
  resetEventPlatform();
}

export type { AgentEventOutputs, AgentPlatformOptions } from "../agent/event-outputs.js";
