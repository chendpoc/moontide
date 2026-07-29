import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { setWorkdir } from "../config.js";
import { createDefaultCatalog } from "../register-defaults.js";
import { createDefaultLoopContext, createToolContext } from "./deps.js";
import type { ToolContext } from "../toolkit/types.js";

export { setWorkdir };
export { safePath, runRead, runWrite, runEdit, runGlob, runListDir } from "../builtins/fs.js";
export { runBash } from "../builtins/bash.js";

const catalog = createDefaultCatalog();

export const TOOL_SCHEMAS: Tool[] = catalog.schemas();

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext = createToolContext(createDefaultLoopContext()),
): Promise<string> {
  return catalog.execute(name, toolInput, ctx);
}

export { probeAll as probeCodeRuntimes } from "../extensions/code-repl/registry.js";
