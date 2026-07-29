import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

export type ToolHandler = (input: Record<string, unknown>) => string | Promise<string>;

export interface ToolDefinition {
  schema: Tool;
  handler: ToolHandler;
}

const definitions: ToolDefinition[] = [];

export function registerTool(def: ToolDefinition): void {
  definitions.push(def);
}

export function getRegisteredTools(): readonly ToolDefinition[] {
  return definitions;
}

export function buildToolSchemas(): Tool[] {
  return definitions.map((def) => def.schema);
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return definitions.find((def) => def.schema.name === name)?.handler;
}
