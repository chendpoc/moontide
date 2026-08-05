import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runInspectContext } from "./inspect-context.js";

const CONTEXT_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.INSPECT_CONTEXT,
    description:
      "Inspect current conversation context window usage, token breakdown, and headroom.",
    permission: { kind: "fixed", decision: "allow" },
    capability: "read",
    input_schema: {
      type: "object",
      properties: {
        detail: {
          type: "string",
          enum: ["summary", "struct", "breakdown", "full"],
          description: "Level of detail in the report.",
        },
        exact: {
          type: "boolean",
          description: "Use API countTokens for exact input token count (extra API call).",
        },
      },
    },
    run: (input) => runInspectContext(input),
  },
];

export function defineContextTools(): ToolDefinition[] {
  return defineTools(CONTEXT_TOOL_SPECS);
}
