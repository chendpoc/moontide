import { inspectContext } from "../../../context-inspect/index.js";
import { defineTools, type ToolSpec } from "../../../tools/define-tool.js";
import type { ToolDefinition } from "../../../tools/types.js";
import { TOOL_NAMES } from "../../../tools/names.js";

const INSPECT_CONTEXT_SPEC: ToolSpec = {
  name: TOOL_NAMES.INSPECT_CONTEXT,
  description:
    "Inspect current conversation context window usage, token breakdown, and headroom.",
  permission: { kind: "fixed", decision: "allow" },
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
  run: (input, _ctx) => {
    const detail = String(input.detail ?? "summary") as "summary" | "struct" | "breakdown" | "full";
    const exact = input.exact === true || input.exact === "true";
    return inspectContext(detail, exact);
  },
};

export function defineInspectContextTool(): ToolDefinition {
  return defineTools([INSPECT_CONTEXT_SPEC])[0]!;
}
