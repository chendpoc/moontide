import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { createDefaultLoopContext, createToolContext } from "../deps.js";
import type { ToolCatalog } from "./catalog.js";
import { createDefaultCatalog } from "./register-defaults.js";
import type { ToolContext } from "./types.js";

export type { ToolCatalog } from "./catalog.js";
export { createToolCatalog } from "./catalog.js";
export { createDefaultCatalog } from "./register-defaults.js";
export { TOOL_NAMES, type ToolName } from "./names.js";
export type {
  ToolContext,
  ToolDefinition,
  ToolHandler,
  UserInteraction,
} from "./types.js";

let catalog: ToolCatalog = createDefaultCatalog();

export function getToolCatalog(): ToolCatalog {
  return catalog;
}

export function setToolCatalog(next: ToolCatalog): void {
  catalog = next;
}

export function resetToolCatalog(): void {
  catalog = createDefaultCatalog();
}

export function toolSchemas(): Tool[] {
  return catalog.schemas();
}

export async function executeTool(
  name: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext = createToolContext(createDefaultLoopContext()),
): Promise<string> {
  return catalog.execute(name, toolInput, ctx);
}
