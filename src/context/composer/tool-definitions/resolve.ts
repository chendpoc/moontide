import { getToolDefinitions } from "../../../tools/definitions.js";
import type { ToolSchema } from "../../../llm/protocol/types.js";
import type { ResolveToolDefinitionsInput } from "./types.js";

/** Resolve Tool Definitions for Context Composer → `LLMRequest.tools`. */
export function resolveToolDefinitions(_input?: ResolveToolDefinitionsInput): ToolSchema[] {
  return [...getToolDefinitions()].sort((a, b) => a.name.localeCompare(b.name));
}
