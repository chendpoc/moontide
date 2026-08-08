import type { ToolSchema } from "@moontide/llm/protocol";
import type { ToolDefinition } from "./types.js";

/** Minimal registry surface for tool execution without importing agent/. */
export interface ToolRegistryPort {
  getTool(name: string): ToolDefinition | undefined;
  getToolSchemas(): ToolSchema[];
}
