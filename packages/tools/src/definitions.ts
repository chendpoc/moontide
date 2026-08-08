import type { ToolSchema } from "@moontide/llm/protocol";
import type { ToolRegistryPort } from "./registry-port.js";

export function getToolDefinitions(registry: ToolRegistryPort): ToolSchema[] {
  return registry.getToolSchemas();
}
