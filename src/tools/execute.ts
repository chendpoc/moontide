import type { ToolContext } from "./types.js";

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  if (!ctx.runtime) {
    throw new Error("ToolContext.runtime is required");
  }
  const tool = ctx.runtime.tools.getTool(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.handler(toolInput, ctx);
}
