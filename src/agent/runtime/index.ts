import { getWorkdir } from "../../config.js";
import { PluginHost } from "../../plugins/host/host.js";
import { ToolRegistry } from "../../tools/registry.js";
import { buildDefaultHookManifest } from "../hooks/manifest.js";
import { HookDispatcher } from "../hooks/dispatcher.js";
import { HookRegistry } from "./hook-registry.js";

export { HookRegistry, type SidecarHookRegistry } from "./hook-registry.js";
export { ToolRegistry } from "../../tools/registry.js";

export class AgentRuntime {
  readonly hookRegistry = new HookRegistry();
  readonly hooks: HookDispatcher;
  readonly tools = new ToolRegistry();
  readonly plugins: PluginHost;
  private defaultHookDisposers: Array<() => void> = [];

  constructor() {
    this.hooks = new HookDispatcher(this.hookRegistry);
    this.plugins = new PluginHost(this);
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
