import { createDefaultToolContext } from "../agent/deps.js";
import { getTool } from "./store.js";
import type { ToolContext } from "./types.js";

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext = createDefaultToolContext(),
): Promise<string> {
  const tool = getTool(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.handler(toolInput, ctx);
}
