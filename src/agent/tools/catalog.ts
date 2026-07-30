import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ToolContext, ToolDefinition } from "./types.js";

export interface ToolCatalog {
  schemas(): Tool[];
  execute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export function createToolCatalog(tools: ToolDefinition[]): ToolCatalog {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    const name = tool.schema.name;
    if (name) {
      byName.set(name, tool);
    }
  }

  return {
    schemas() {
      return [...byName.values()].map((def) => def.schema);
    },
    async execute(name, input, ctx) {
      const def = byName.get(name);
      if (!def) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return def.handler(input, ctx);
    },
  };
}
