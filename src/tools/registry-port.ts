import type { ToolSchema } from "../llm/protocol/types.js";
import type { ToolDefinition } from "./types.js";

/** Minimal registry surface for tool execution without importing agent/. */
export interface ToolRegistryPort {
  getTool(name: string): ToolDefinition | undefined;
  getToolSchemas(): ToolSchema[];
}
