import type { ToolSchema } from "../llm/protocol/types.js";
import type { ToolRegistryPort } from "./registry-port.js";

export function getToolDefinitions(registry: ToolRegistryPort): ToolSchema[] {
  return registry.getToolSchemas();
}
