import { inspectContext } from "../context/index.js";
import { registerTool } from "./registry.js";

registerTool({
  schema: {
    name: "inspect_context",
    description:
      "Inspect current conversation context window usage, token breakdown, and headroom.",
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
  },
  handler: (input) => {
    const detail = String(input.detail ?? "summary") as "summary" | "struct" | "breakdown" | "full";
    const exact = input.exact === true || input.exact === "true";
    return inspectContext(detail, exact);
  },
});
