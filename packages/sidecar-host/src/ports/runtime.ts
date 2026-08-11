import type { ToolDefinition } from "@moontide/tools";

export interface SidecarObserverRegistryPort {
  on(
    phase: string,
    name: string,
    handler: (ctx: unknown) => unknown | Promise<unknown>,
    options?: { order?: number; errorPolicy?: "fail-open" | "fail-closed" },
  ): () => void;
}

/** Harness port: run observer registry + tool registry merge for sidecar attach. */
export interface SidecarHostRuntimePort {
  sidecarObservers(): SidecarObserverRegistryPort;
  pluginToolName(pluginId: string, toolName: string): string;
  addPluginTools(tools: ToolDefinition[]): () => void;
}

/** @deprecated Use SidecarObserverRegistryPort */
export type SidecarHookRegistryPort = SidecarObserverRegistryPort;
