import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { setWorkdir } from "../config.js";

export { setWorkdir };
export { safePath, runRead, runWrite, runEdit, runGlob } from "./fs.js";
export { runBash } from "./bash.js";

import "./fs-tools.js";
import "./inspect-context.js";

import { buildToolSchemas, getToolHandler } from "./registry.js";

export const TOOL_SCHEMAS: Tool[] = buildToolSchemas();

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  const handler = getToolHandler(name);
  if (!handler) {
    return `Error: unknown tool ${name}`;
  }
  return handler(toolInput);
}
