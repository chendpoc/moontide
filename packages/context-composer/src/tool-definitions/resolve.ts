import type { ToolSchema } from "@moontide/llm/protocol";

import type { ResolveToolDefinitionsInput } from "./types.js";

/** Narrow port for resolving tool schemas without importing Harness runtime. */
export interface ToolDefinitionsPort {
  getToolSchemas(): ToolSchema[];
}

/** Resolve tool schemas from a registry port or pre-resolved list (name-sorted). */
export function resolveToolDefinitions(
  source: ToolDefinitionsPort | ToolSchema[],
  _input?: ResolveToolDefinitionsInput,
): ToolSchema[] {
  const schemas = Array.isArray(source) ? source : source.getToolSchemas();
  return [...schemas].sort((a, b) => a.name.localeCompare(b.name));
}
