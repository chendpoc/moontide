import type { ToolSchema } from "../llm/protocol/types.js";
import { getTools } from "./store.js";

/** Tool Definitions snapshot for this turn (`LLMRequest.tools`). */
export function getToolDefinitions(): ToolSchema[] {
  return getTools().map((tool) => tool.schema);
}
