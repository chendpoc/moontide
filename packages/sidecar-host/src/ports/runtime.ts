import type { ToolDefinition } from "@moontide/tools";

export interface SidecarHookRegistryPort {
  on(
    phase: string,
    name: string,
    handler: (ctx: unknown) => unknown | Promise<unknown>,
    options?: { order?: number; errorPolicy?: "fail-open" | "fail-closed" },
  ): () => void;
}

/** Harness port: hook registry + tool registry merge for sidecar attach. */
export interface SidecarHostRuntimePort {
  sidecarHooks(): SidecarHookRegistryPort;
  pluginToolName(pluginId: string, toolName: string): string;
  addPluginTools(tools: ToolDefinition[]): () => void;
}
