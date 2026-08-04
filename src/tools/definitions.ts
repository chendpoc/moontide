import type { ToolSchema } from "../llm/protocol/types.js";
import type { AgentRuntime } from "../agent/runtime/index.js";

export function getToolDefinitions(runtime: AgentRuntime): ToolSchema[] {
  return runtime.tools.getToolSchemas();
}
