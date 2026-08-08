import type { AgentRuntime } from "../agent/runtime/index.js";
import { setupToolsPorts } from "../agent/tools-setup.js";
import { getWorkdir } from "../config.js";
import { configureOutputs, resetEventPlatform } from "../log/setup.js";
import { registerBuiltinWorkMemPorts } from "../plugins/builtin/work-mem/register.js";
import { bootstrapPlugins } from "@moontide/sidecar-host";

/** Reset and register default sidecar hooks on the runtime. */
export function setupAgentHooks(runtime: AgentRuntime, workdir = getWorkdir()): void {
  runtime.resetSidecarHooks();
  runtime.registerDefaultSidecarHooks(workdir);
}

/** Hooks + event outputs — no plugin attach (tests and lightweight REPL turns). */
export function setupAgentEventPipeline(runtime: AgentRuntime, workdir = getWorkdir()): void {
  setupAgentHooks(runtime, workdir);
  configureOutputs(workdir);
}

/** Full agent platform: hooks, event outputs, startup plugins. */
export async function bootstrapAgentPlatform(
  workdir: string,
  runtime: AgentRuntime,
): Promise<void> {
  setupToolsPorts();
  setupAgentEventPipeline(runtime, workdir);
  registerBuiltinWorkMemPorts();
  await bootstrapPlugins(workdir, runtime.plugins);
}

export function teardownAgentPlatform(runtime: AgentRuntime): void {
  runtime.plugins.shutdown();
  runtime.resetSidecarHooks();
  resetEventPlatform();
}
