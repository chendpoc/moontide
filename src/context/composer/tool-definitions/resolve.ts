import type { ToolSchema } from "../../../llm/protocol/types.js";

import { getToolDefinitions } from "../../../tools/definitions.js";
import type { AgentRuntime } from "../../../agent/runtime/index.js";
import type { ResolveToolDefinitionsInput } from "./types.js";

/** Resolve tool schemas from the active AgentRuntime (name-sorted). */
export function resolveToolDefinitions(
  runtime: AgentRuntime,
  _input?: ResolveToolDefinitionsInput,
): ToolSchema[] {
  return [...getToolDefinitions(runtime)].sort((a, b) => a.name.localeCompare(b.name));
}
