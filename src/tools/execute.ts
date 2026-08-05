import { toolError } from "../errors/factories.js";
import type { ToolContext } from "./types.js";

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  if (!ctx.runtime) {
    throw toolError("ToolContext.runtime is required");
  }
  const tool = ctx.runtime.tools.getTool(name);
  if (!tool) {
    throw toolError(`Unknown tool: ${name}`, { context: { toolName: name } });
  }
  return tool.handler(toolInput, ctx);
}
