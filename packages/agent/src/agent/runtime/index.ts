import { PluginHost } from "@moontide/sidecar-host";
import type { SidecarHostRuntimePort } from "@moontide/sidecar-host/ports";
import { ToolRegistry } from "@moontide/tools";
import type { AgentEventPipeline } from "../event-pipeline.js";
import { getWorkdir } from "../../config.js";
import { registerDefaultTools } from "../../tools/register-defaults.js";
import { buildDefaultObserverManifest } from "../run-observers/manifest.js";
import { RunObserverDispatcher } from "../run-observers/dispatcher.js";
import { RunObserverRegistry } from "./observer-registry.js";

function createSidecarHostPort(
  observerRegistry: RunObserverRegistry,
  tools: ToolRegistry,
): SidecarHostRuntimePort {
  return {
    sidecarObservers: () => observerRegistry.sidecar(),
    pluginToolName: (pluginId, toolName) => tools.pluginToolName(pluginId, toolName),
    addPluginTools: (pluginTools) => tools.addPluginTools(pluginTools),
  };
}

export { RunObserverRegistry, type SidecarRunObserverRegistry } from "./observer-registry.js";
export { ToolRegistry } from "@moontide/tools";

export class AgentRuntime {
  readonly observerRegistry = new RunObserverRegistry();
  readonly observers: RunObserverDispatcher;
  readonly tools = new ToolRegistry(registerDefaultTools);
  readonly plugins: PluginHost;
  eventPipeline: AgentEventPipeline | undefined;
  private defaultObserverDisposers: Array<() => void> = [];

  constructor() {
    this.observers = new RunObserverDispatcher(this.observerRegistry);
    this.plugins = new PluginHost(createSidecarHostPort(this.observerRegistry, this.tools));
  }

  reset(): void {
    this.resetSidecarObservers();
    this.tools.reset();
    this.plugins.shutdown();
    this.eventPipeline = undefined;
  }

  registerDefaultSidecarObservers(workdir = getWorkdir()): void {
    this.clearDefaultSidecarObservers();
    const observers = this.observerRegistry.sidecar();
    for (const spec of buildDefaultObserverManifest()) {
      this.defaultObserverDisposers.push(spec.register(observers, workdir));
    }
  }

  clearDefaultSidecarObservers(): void {
    for (const dispose of this.defaultObserverDisposers) {
      dispose();
    }
    this.defaultObserverDisposers = [];
  }

  resetSidecarObservers(): void {
    this.clearDefaultSidecarObservers();
    this.observerRegistry.clear();
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
