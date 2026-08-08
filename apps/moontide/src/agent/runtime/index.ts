import { PluginHost } from "@moontide/sidecar-host";
import type { SidecarHostRuntimePort } from "@moontide/sidecar-host/ports";
import { ToolRegistry } from "@moontide/tools";
import { getWorkdir } from "../../config.js";
import { registerDefaultTools } from "../../tools/register-defaults.js";
import { buildDefaultHookManifest } from "../hooks/manifest.js";
import { HookDispatcher } from "../hooks/dispatcher.js";
import { HookRegistry } from "./hook-registry.js";

function createSidecarHostPort(
  hookRegistry: HookRegistry,
  tools: ToolRegistry,
): SidecarHostRuntimePort {
  return {
    sidecarHooks: () => hookRegistry.sidecar(),
    pluginToolName: (pluginId, toolName) => tools.pluginToolName(pluginId, toolName),
    addPluginTools: (pluginTools) => tools.addPluginTools(pluginTools),
  };
}

export { HookRegistry, type SidecarHookRegistry } from "./hook-registry.js";
export { ToolRegistry } from "@moontide/tools";

export class AgentRuntime {
  readonly hookRegistry = new HookRegistry();
  readonly hooks: HookDispatcher;
  readonly tools = new ToolRegistry(registerDefaultTools);
  readonly plugins: PluginHost;
  private defaultHookDisposers: Array<() => void> = [];

  constructor() {
    this.hooks = new HookDispatcher(this.hookRegistry);
    this.plugins = new PluginHost(createSidecarHostPort(this.hookRegistry, this.tools));
  }

  reset(): void {
    this.resetSidecarHooks();
    this.tools.reset();
    this.plugins.shutdown();
  }

  registerDefaultSidecarHooks(workdir = getWorkdir()): void {
    this.clearDefaultSidecarHooks();
    const hooks = this.hookRegistry.sidecar();
    for (const spec of buildDefaultHookManifest()) {
      this.defaultHookDisposers.push(spec.register(hooks, workdir));
    }
  }

  clearDefaultSidecarHooks(): void {
    for (const dispose of this.defaultHookDisposers) {
      dispose();
    }
    this.defaultHookDisposers = [];
  }

  resetSidecarHooks(): void {
    this.clearDefaultSidecarHooks();
    this.hookRegistry.clear();
  }
}

let currentRuntime: AgentRuntime | undefined;

export function createAgentRuntime(): AgentRuntime {
  return new AgentRuntime();
}

/** Composition root accessor — create explicitly in tests via setAgentRuntime(). */
export function getAgentRuntime(): AgentRuntime {
  if (!currentRuntime) {
    currentRuntime = createAgentRuntime();
  }
  return currentRuntime;
}

export function setAgentRuntime(runtime: AgentRuntime | undefined): void {
  currentRuntime = runtime;
}
