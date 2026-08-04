import type { AgentRuntime } from "../agent/runtime/index.js";
import { getWorkdir } from "../config.js";
import { configureOutputs, resetEventPlatform } from "../log/setup.js";
import { bootstrapPlugins } from "../plugins/host/host.js";

/** Reset and register default sidecar hooks on the runtime. */
export function setupAgentHooks(runtime: AgentRuntime, workdir = getWorkdir()): void {
  runtime.resetSidecarHooks();
  runtime.registerDefaultSidecarHooks(workdir);
}

/** Hooks + event outputs — no plugin attach (tests and lightweight REPL turns). */
export function setupAgentEventPipeline(runtime: AgentRuntime, workdir = getWorkdir()): void {
  setupAgentHooks(runtime, workdir);
  configureOutputs();
}

/** Full agent platform: hooks, event outputs, startup plugins. */
export async function bootstrapAgentPlatform(
  workdir: string,
  runtime: AgentRuntime,
): Promise<void> {
  setupAgentEventPipeline(runtime, workdir);
  await bootstrapPlugins(workdir, runtime);
}

export function teardownAgentPlatform(runtime: AgentRuntime): void {
  runtime.plugins.shutdown();
  runtime.resetSidecarHooks();
  resetEventPlatform();
}
